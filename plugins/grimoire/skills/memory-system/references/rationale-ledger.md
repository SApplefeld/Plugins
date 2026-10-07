# Rationale ledger: memory-system

This file is the rationale ledger for the documents the `memory-system` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/memory-system/SKILL.md

This document is the operating manual for the kit memory store's extension layer: the memory records the shared memory database holds plus an outcome journal, used-tracking, tags, a decay lifecycle, a shared project-type tier, an operator tier, and the `memq` CLI that reaches all of them. It owns the moments where a session touches that store beyond reading one record: recalling the whole store at effort start or a seat takeover, reporting what the store recorded during a session, logging an action outcome, stamping a memory applied, tagging, running or reading the decay pass, pinning against decay, writing or repairing or deleting a shared-tier record, recording file anchors and recognition triggers on a record, and interpreting a refusal when a memory write is denied. It also owns how `memq` resolves which store answers from a given working directory, which verbs stand down on a network share, and how each verb's output and exit status must be read. Load class: `named-trigger` - the frontmatter description says to use it when working with the store beyond plain memory files and lists the specific verbs, fields and error states that trigger it, so it is loaded before one of those acts rather than at session start or at every plan run.

Extracted at `6bc07fb`: lines 1-39 (`skills.memory-system.c1.md`); lines 40-146 (`skills.memory-system.c2.md`); lines 147-208 (`skills.memory-system.c3.md`); lines 209-255 (`skills.memory-system.c4.md`); lines 256-316 (`skills.memory-system.c5.md`). Re-extracted at `4b2e64c` over the hunks the Section 8 merge changed (`S` entries below). Amended by the finishing pass of `docs/plans/claude-kit_corpus-rewrite-follow-up_spec_v1.md` on 2026-09-14 (`T` entries below, their source lines read at that pass's fix rounds 1 and 2). Amended on 2026-09-25 by `docs/plans/claude-kit_persona-memory-port_spec_v1.md` sections 3, 5 and 6 (`D` entries below). Redrafted on 2026-09-26 by section 6 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `c3de1f16` with its fix round at `894c89d4`, so every live entry's `passage:` line quotes the text at `894c89d4` and the `flag:` lines record that pass's flags. Redrafted on 2026-10-01 by section 5 of `docs/plans/claude-kit_mechanism-cut_spec_v1.md`, which applied that plan's cut list, so every live entry's `passage:` line quotes the text that section landed, and the entries its drop rows retired carry `ruled: cut 2026-09-30`. Amended on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and `memq` its one door (`E` entries below); an entry whose rule that section kept in new words reads `rewrite` with its `passage:` quoting the new text, and an entry whose passage that section deleted reads `retire`, with a `superseded-by:` line only where an `E` entry's passage carries its rule. Amended on 2026-10-04 by section 6 of the same plan, which made `delete-type` and `delete-operator` mark the record's database row deleted rather than remove files (`E007` and `E008` below), and respelled the `forget` row to match the soft delete it already sent (`E009` below). Amended on 2026-10-04 by section 7 of the same plan, which stands a store root that is not the machine's own down from the memory database (`E010` below).

### c1.C001
- key: Load this skill before any work on the kit memory store that goes beyond plain memory files.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:3
- provenance: 8e22ff4 2026-07-31, the commit that installed the memory extension layer (memq CLI, outcome journal, decay lifecycle, type tier) and this skill with it.
- verdict: rewrite
- landed: 227ba108 section 5
- reason: This document is the owner the doctrine's memory bullet and the ownership map point at, and the frontmatter description is the load trigger of that owner. Doctrine pointer and skill owner are two intentionally different roles, not two rules. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Use when working with the kit memory store beyond reading one record

### c1.C002
- key: Reach the journal, used-tracking, tags, decay, the type tier and the operator tier through the `memq` CLI.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 8e22ff4 2026-07-31, the memory extension install that made memq the single door to the layer.
- verdict: keep
- reason: Nothing mechanical routes a session to memq: the frontmatter guard refuses the shared tiers' Write only and leaves the sidecars out of scope, so a shell can still hand-write `outcomes.jsonl`. This sentence is the only thing that names the door.
- passage: All of it is reached through the `memq` CLI.

### c1.C003
- key: Expect `memq` to resolve the store in this order: spelling refusal, honored pin, worktree main root, this session's own filing, plain cwd.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 555407f 2026-09-01, the memory-read-side plan, installed after records landed in a store the writing session had not read.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 858 (Store resolution order internals), dropped under the mechanism cut.
- proposed: State the resolver order once, in the closing ordered sentence, and drop the opening paragraph's second narration of the same order.
- baseline-test: yes
- passage: `memq` resolves the store in this order.
- passage: Last, the plain cwd stands in for its own root.
- ruled: cut 2026-09-30

### c1.C004
- key: Expect a worktree to resolve the same store its main checkout does, and a bare-repo worktree to keep its own.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 945a75c 2026-08-19, the worktree-store-and-autosync plan, which folded a worktree onto its main checkout's store after the per-worktree split.
- verdict: keep
- reason: The fold's consequence is still live: the operator record unstamped-lists-peer-session-reads records a worktree's unstamped report listing a peer session's reads because both share one store. memq.js performs the fold and tells the session nothing.
- passage: `memq` resolves the store itself: a linked worktree of an ordinary checkout resolves the same store as its main checkout, a subdirectory of the project resolves its project's store in a session filed under that project, and a store pin (`KIT_MEMORY_PROJECT`), honored only under the engine store signals below, fixes the store regardless of the working directory.

### c1.C005
- key: Set `KIT_MEMORY_PROJECT` to fix the store by environment so the working directory does not choose it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 2fd5c9c 2026-08-01, the instance-store-pin plan for engine-spawned sessions; the bound was corrected by 2ac43f4 2026-08-28 after the skill promised an escape hatch the code ignored.
- verdict: keep
- reason: A session choosing whether to set the pin, which is the remedy line 8 offers for a mapped drive, needs the bound before it acts. The stderr note that the pin was ignored only fires afterwards.
- passage: `memq` resolves the store itself: a linked worktree of an ordinary checkout resolves the same store as its main checkout, a subdirectory of the project resolves its project's store in a session filed under that project, and a store pin (`KIT_MEMORY_PROJECT`), honored only under the engine store signals below, fixes the store regardless of the working directory.

### c1.C006
- key: Expect a refusal on a working directory spelled relative, or rooted win32 with one leading backslash and no drive, ahead of everything including the pin.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 555407f 2026-09-01, the memory-read-side plan's resolver.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The spelling refusal throws in memq.js with its cause in words, ahead of everything, and a harness session never stands on a relative or drive-less directory. Safe because the refusal names the spelling it met. Lands with the resolver's order sentence carrying a one-clause definition of the spelling refusal (a relative path, or a win32 spelling rooted on a single backslash and naming no drive), since that sentence names the refusal and the cut left the name with no referent; the throw's cause in words stays the full statement.
- proposed: Drop the spelling-grammar enumeration from line 8; the refusal names the spelling it met.

### c1.C007
- key: Expect twelve verbs to stand down on an unpinned working directory naming a network share: log, find, get, recall, recent, unstamped, touch, anchor, triggers, decay-scan, decay-prune, decay-done.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: c0a1388 2026-08-26, the memq-network-cwd-resolver plan, installed after the SessionStart hook hung on an SMB timeout.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Every stood-down verb refuses at its own door with the cause on stderr, and the enumeration's own failure mode was drifting from the code (2ac43f4 corrected the door count). The stderr-reading rule c1.C010 and the remedies c1.C008 and c1.C012 stay. Its landing respelled c1.C008's keep sentence; c1.C008 records the flip.
- proposed: Replace the twelve-verb enumeration with one sentence saying every verb that resolves the project directory from an unpinned network working directory refuses with its cause on stderr.

### c1.C008
- key: Use `--operator` or `--type=<type>` to get `get`, `touch` and `triggers` past the network stand-down.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 2ac43f4 2026-08-28, the round that named the real doors and stopped the skill promising an escape hatch the code ignored.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Which spellings get past the stand-down is a remedy a session types, and no refusal tells a caller the flag exists. The orientation sentence at A003 is what routes it here. Flipped from keep to rewrite at section 22's close: c1.C007's retire dropped the twelve-verb enumeration, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Three of those verbs carry an exception inside the verb, and it is the same one at each: `get`, `touch` and `triggers` let `--operator` and `--type=<type>` past, both of which resolve their tier from the store root with no working directory in it, while every other form of those verbs, bare `--type` included, meets the refusal.
- passage: `get`, `touch` and `triggers` still pass with `--operator` or `--type=<type>`, which resolve their tier from the store root.

### c1.C009
- key: Expect `add-type`, `add-operator`, `delete-type` and `delete-operator` to run past the network refusal untouched.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: c0a1388 2026-08-26, the network-cwd-resolver plan; wording settled at 2ac43f4 2026-08-28.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The four shared-tier verbs never consult the working directory, which memq.js decides and no session acts on beforehand. It is the complement of the retired twelve-verb enumeration and leaves with it.
- proposed: Drop with the twelve-verb enumeration.

### c1.C010
- key: Read the stderr line after a stood-down verb, because the exit status alone cannot tell a refusal from a clean read of an empty store.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: c98af86 2026-08-28, which checked an exit-status claim the network plan had made five times without ever testing it.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The split is incident-born and nothing enforces it, so the reading rule stays; 2ac43f4 chose exit 0 for a stood-down read by design, which makes stderr the verdict channel there. Only the second narration of the split and the mapped-drive internals go. Lands as two sentences, the exit split and then the stderr-reading consequence, per the sentence bars; the mapped-drive passage is cut to the residual and the pin remedy.
- proposed: Keep the stderr-reading rule and the writing/reading exit split in one sentence, and cut the mapped-drive passage to the residual and the pin remedy.
- baseline-test: yes
- passage: A refused writing verb exits non-zero, and a refused reading verb exits 0 with empty stdout. So read the stderr line, since status alone cannot tell a stood-down `recall` from a clean read of an empty store.

### c1.C011
- key: Expect `find` to withhold both the project-tier and the machine-wide answer under the network refusal, and to say both were withheld.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 2ac43f4 2026-08-28, which made the stand-down message say both channels were withheld so an unsearched channel could not read as empty.
- verdict: retire
- landed: d2c43f1 section 22
- reason: find's own message states it when it fires. Safe because the machinery that replaces the prose is the message the session is already told to read (c1.C010).
- proposed: Drop the find-withholds-both sentence from line 8.

### c1.C012
- key: Use the store pin to avoid the resolver's walk when the working directory sits on a mapped network drive.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: c98af86 2026-08-28, the same check that found the mapped-drive residual the share refusal does not cover.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 859 (Network share refusal semantics) shrink cuts the mapped-drive residual, and its remedy is an engine-only escape that an attended session cannot take.
- passage: The refusal reads the path's spelling alone: a path opening with two separators is a share. So a drive letter mapped to a share is not refused and rides the resolver's walk, which can block. Where a mapped drive is the shape in front of you, the store pin is what avoids the walk.

### c1.C013
- key: Read the fleet section at the end of this skill for the full rule governing verbs withheld under the engine store signals.
- class: pointer
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: d7499c8 2026-08-22, the finishing pass that made the shared-tier effort's prose meet its own code and gave the fleet section its ownership.
- verdict: retire
- reason: row 864 removes the withholding clauses from the table cells, so this pointer serves nothing in this part. The unattended-vector paragraph under Shared-Tier Repair and Removal carries the rule.
- passage: A row that withholds a verb under them is naming that worker, and the unattended-vector paragraph under Shared-Tier Repair and Removal owns the full rule.

### c1.C014
- key: Run the kit doctor with `-Fix` when `memq` does not resolve in the shell, because the shim is not installed.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 8e22ff4 2026-07-31, the memory extension install, which shipped the shim and the doctor remedy together.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Flipped from keep to rewrite at the corpus rewrite's finishing fix round: read as an instruction to run `-Fix`, the sentence contradicted its owner (kit-doctor:27, "Do not run it unprompted"), so it is phrased as the ask for that run, the owner unchanged. It remains the remedy for the CLI the whole document assumes not being on the path.
- proposed: If `memq` does not resolve in the shell, the shim is not installed: ask for a kit doctor `-Fix` run (the kit-doctor skill owns that run).
- passage: If `memq` does not resolve in the shell, the shim is not installed: ask for a kit doctor `-Fix` run (the kit-doctor skill owns that run).

### c1.C015
- key: Never hand-edit `outcomes.jsonl` or `usage.jsonl`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: 8e22ff4 2026-07-31, the original install of the journals; the residue and delete detail around it came later (b136b28 2026-08-22).
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Nothing enforces the rule: the frontmatter guard leaves the sidecars out of scope by design, so a hand edit still races the read-stamp hook. The bold rule and the three sentences a session acts on stay; the writer list, step order and residue taxonomy leave to their owners. Its landing respelled c1.C019's keep sentence; c1.C019 records the flip. Its landing respelled c1.C020's keep sentence; c1.C020 records the flip. Its landing respelled c1.C108's keep sentence; c1.C108 records the flip. Lands with two sentences after the bold rule naming the residue's subject (a confirmed shared-tier delete's three-backup sweep, pointed at the Delete bullet) ahead of the residue sentences, since the cut left the sweep, the delete and the stop with no antecedent in the paragraph. The writer list and step order the proposal moves here have their home in c1.C017's reason and in the CLI's own failure line rather than in this ledger.
- proposed: Cut line 14 to the bold rule plus one sentence each for C019, C022 and C023, and move the writer list, step order and residue taxonomy to this ledger or to the Delete bullet at line 160.
- baseline-test: yes
- passage: **Never hand-edit `outcomes.jsonl` or `usage.jsonl`.**

### c1.C016
- key: Treat a hand edit as racing the hook that appends on every memory read, including your own.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: 8e22ff4 2026-07-31, attached to the never-hand-edit rule at its install.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The rule is obeyed without knowing what the edit races, and a0edaed's lesson on this document is that attached reasons kept dying while the rule survived eight rounds. The why now lives in this ledger.
- proposed: Drop the closing sentence of line 14; the ledger carries the race.
- baseline-test: yes

### c1.C017
- key: Expect only `memq` and the read-stamp hook to write those journals, and only `decay-prune` and the delete verbs to rewrite them.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: 8e22ff4 2026-07-31, extended by d7499c8 2026-08-22 when the shared-tier locks landed.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Which paths write and rewrite the sidecars is a fact about memq.js (rewriteWithBackup under `decay.lock` and `store.lock`) that supports c1.C015 and directs no act of its own.
- proposed: Drop the writer and rewriter enumeration from line 14.

### c1.C018
- key: Expect every rewrite to leave a `.bak` beside the file, the decay pass to keep its backups and a confirmed delete to sweep its three.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: 752dbce 2026-08-22, the shared-tier repair-and-delete section, installed because an index line's backup carries the removed record's body.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The Delete bullet at line 160 already states the three-target sweep, so line 14's copy is a duplicate whose owner carries it. The residue warning a session acts on is c1.C019, which stays.
- proposed: Drop the backup-sweep description from line 14; line 160 carries it.

### c1.C019
- key: Do not read a zero exit from a delete as evidence the backup residue is gone.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: 752dbce 2026-08-22 installed the sweep; ae2c70a 2026-08-22 read the skill against the shipped CLI and kept the residue report off the exit code deliberately.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 862 (Never hand-edit journal sidecars) cuts the residue catalogue to the stopped-delete sentence the bold-lead bullet keeps, and row 890 (Shared-tier repair and delete mechanics) drops the residue detail from the Delete bullet, so no landed text carries this caveat.
- proposed: A backup the sweep could not remove is reported on stderr and deliberately does not fail the delete, so a zero exit is not by itself evidence the residue is gone.
- passage: A backup the sweep could not remove is reported on stderr and deliberately does not fail the delete, so a zero exit is not by itself evidence the residue is gone.

### c1.C020
- key: Expect `<file>.tmp.<pid>` files stranded by a hard-killed rewrite to survive the sweep unnamed.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: b136b28 2026-08-22, the fable confirmation round that fixed what it found in the delete's residue account.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 862 (Never hand-edit journal sidecars) cuts the residue catalogue to the stopped-delete sentence the bold-lead bullet keeps, and row 890 (Shared-tier repair and delete mechanics) drops the residue detail from the Delete bullet, so no landed text carries this caveat.
- proposed: A `<file>.tmp.<pid>` a hard-killed rewrite stranded at one of the sweep's three paths survives it unnamed,
- passage: A `<file>.tmp.<pid>` a hard-killed rewrite stranded at one of the sweep's three paths survives it unnamed.

### c1.C021
- key: Treat backup and temp copies as machine-local, since the store's sync refuses `*.bak` and `*.tmp.*`.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: ae2c70a 2026-08-22, the read-whole-against-the-CLI pass.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The same fact is stated at line 205 where the rotation decision is actually made, and c1.C019 and c1.C020 are obeyed without it here.
- proposed: Drop the sync-refuses sentence from line 14; line 205 keeps it where the rotation question is asked.
- baseline-test: yes

### c1.C022
- key: Read the failure line naming exactly what a stopped delete removed, rather than inferring it from the step order.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: b136b28 2026-08-22, the confirmation round that corrected the delete's step account; retired 2026-10-04 by the finishing pass of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`.
- verdict: retire
- reason: A shared-tier delete sends one row marking the record deleted and removes no file, so no delete stops partway and no failure line names removed files; the passage is gone from the skill.
- passage: A shared-tier delete that stopped partway is finished by re-running the same delete under its consent flag, never by editing either file, and its failure line names what it removed.

### c1.C023
- key: Re-run the same delete under its consent flag to finish the steps a stopped run left.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: b136b28 2026-08-22, alongside c1.C022 in the same correction; retired 2026-10-04 by the finishing pass of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`.
- verdict: retire
- reason: A shared-tier delete sends one database row and unlinks no record file, so there is no half-landed delete for a re-run to finish; the passage is gone from the skill, as c1.C022 records.
- passage: A shared-tier delete that stopped partway is finished by re-running the same delete under its consent flag, never by editing either file, and its failure line names what it removed.

### c1.C024
- key: Never let a journal entry into the memory index.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:15
- provenance: 8e22ff4 2026-07-31, installed with the journal and its `MEMORY.md` pointer.
- verdict: retire
- landed: 227ba108 section 5
- reason: Line 15 is the bold rule, the verbatim pointer a session must reproduce exactly, and one reason; the only loss-free cut is the reason (c1.C026). Nothing else compresses without losing the verbatim line. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: **Journal entries never enter the memory index.**

### c1.C025
- key: Carry in `MEMORY.md` exactly one journal pointer line, verbatim: `Outcomes: outcomes.jsonl holds the action journal; query with memq find <term>.`
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:15
- provenance: 8e22ff4 2026-07-31, with the journal itself.
- verdict: retire
- landed: f92e99ec section 5
- reason: No code writes this line: a grep over the plugin for its text hits only this skill, so the verbatim spelling lives here or nowhere. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: `MEMORY.md` carries exactly one journal pointer line, verbatim: `Outcomes: outcomes.jsonl holds the action journal; query with memq find <term>.`

### c1.C026
- key: Keep the pointer unlike a memory line (`- [Title](file.md) - description`) so index parsers ignore it.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:15
- provenance: 8e22ff4 2026-07-31, attached to the pointer at its install.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A session reproduces the pointer verbatim without knowing why its shape differs from a memory line. The why lives here.
- proposed: Drop the "deliberately does not look like a memory line" sentence from line 15.

### c1.C027
- key: Append one outcome to the project journal with `memq log <key> pass|fail "<summary>" [--tag t]... [--detail "..."]`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:21
- provenance: 8e22ff4 2026-07-31, the journal's install.
- verdict: keep
- reason: A calling convention is what a session types; the CLI enforces the shape only by refusing a wrong one after the fact.
- passage: `memq log <key> pass\|fail "<summary>" [--tag t]... [--detail "..."]` | Append one outcome to the project journal.

### c1.C028
- key: Compose a log summary to 120 characters and a `--detail` to 500 so nothing is cut.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:21
- provenance: 8f2b500 2026-08-08, which stated the input caps after a kaizen note found them invisible and the truncation silent.
- verdict: keep
- reason: `log` truncates and warns rather than refusing, unlike the shared-tier caps, so the compose-to-size rule is not superseded by machinery. It already carries cap, announcement and remedy in one sentence.
- passage: Compose the summary to 120 characters and `--detail` to 500, since past a cap the tail is dropped and the success line announces the cut.

### c1.C029
- key: Re-log the lost tail as its own entry whenever a cut is announced.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:21
- provenance: 8f2b500 2026-08-08, the same caps commit.
- verdict: keep
- reason: The remedy rides in the same sentence as the cap, and nothing performs the re-log for the session; the announcement tells it a tail was lost and not what to do next.
- passage: When a cut is announced, re-log the lost tail as its own entry.

### c1.C030
- key: Expect an unregistered tag to warn and never block.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:21
- provenance: 8e22ff4 2026-07-31, which installed the tag registry with its warn-never-block semantics.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The Tags section at line 125 owns the registry rule whole, with the absent-versus-present semantics at line 126; the log row's clause is a copy with no reason attached, and memq.js prints the warning when it fires.
- proposed: (via A025) Drop "Warns on an unregistered tag, never blocks" from the log row; line 125 carries it.

### c1.C031
- key: Search with `memq find <term> [--tag t] [--outcomes|--memories|--all] [--archived]`, which returns a lexical block then a semantic block.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:22
- provenance: 6cbb24a 2026-08-03, the synced-semantic-memory plan that added the semantic block beside the lexical one.
- verdict: keep
- reason: The row is the reference entry for the verb's signature and output order while the Recall section at line 46 is the rule with its reasoning: index and rule, not two rules. No pointer replaces a signature.
- passage: `memq find <term> [--tag t] [--outcomes\|--memories\|--all] [--archived]` | Hybrid search. The lexical block first,

### c1.C032
- key: Pass `--archived` to see retired records, labeled and demoted, instead of the one counting line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:22
- provenance: 4fe812b 2026-08-03, which made retired records visible on demand rather than silently dropped.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: One clause naming a flag's effect in the reference row, with line 46 carrying the reasoning that suppression is never silent. Flipped from keep to rewrite at section 22's close: c1.C111's retire dropped the antecedent 'retired records', so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: `--archived` shows retired records, labeled and demoted.
- passage: `--archived` shows retired records, labeled and demoted.

### c1.C033
- key: Treat the model-judged block as advisory when a model endpoint is configured.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:22
- provenance: 050587b 2026-08-30, the plan that made the model-judged channel degrade honestly.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The advisory reading survives; what changes is that the row and line 46 both carry the three degrade states at sentence length. The row keeps one clause and the states live in one place.
- proposed: (via A033) Cut the find row's model-judged passage to one clause ("a model-judged block, advisory, where an endpoint is configured") and leave the degrade states to the Recall section.
- passage: A model-judged block follows where an endpoint is configured, and it is advisory.

### c1.C034
- key: Reach records through `recall` and `get` rather than `find` when running as a fleet worker.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:22
- provenance: 752dbce 2026-08-22, the shared-tier authoring effort whose grant model withholds `find` under the engine store signals.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 864 removes the grant notes from the cells. The unattended-vector paragraph under Shared-Tier Repair and Removal carries the withholding of `find`.
- proposed: (via A035) Cut the find row's fleet sentence to "no grant under the engine store signals (the fleet section owns the rule)".
- baseline-test: yes
- passage: No grant under the engine store signals (the unattended-vector paragraph owns the rule).

### c1.C035
- key: Read journal entries or a memory body with `memq get <key|name> [--type|--type=<type>|--operator]`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 8e22ff4 2026-07-31 installed `get`; 6cbb24a 2026-08-03 added its tier flag.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: A calling convention is what a session types, and no machinery types it for the session. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: `memq get <key\|name> [--type\|--type=<type>\|--operator]` | Full journal entries for a key, or a memory record's body

### c1.C036
- key: Pin a tier with `--type` or `--operator` to reach a shared-tier record that a nearer tier shadows by name.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 6cbb24a 2026-08-03 gave `get` one flag or neither; 72ddd3e 2026-09-01 made the flag the pinned tier for the read stamp.
- verdict: keep
- reason: This is genuinely in conflict with c1.C097's direct-read instruction, and history decides for the flag: c1.C097 was written before `get` took a flag at all. Change c1.C036 only by changing the CLI.
- passage: The tier flag (`--type`, `--type=<type>`, `--operator`) is the only way to reach a shared-tier record a nearer tier shadows.

### c1.C037
- key: Use bare `--type` for the working project's declared `Project-Type` and `--type=<type>` to name a tier outright.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 9b1180b 2026-09-03, the MEMQ-TRIGGERS round that settled the two spellings across the verbs.
- verdict: retire
- landed: d2c43f1 section 22
- reason: merged into c1.C057. The triggers row carries both spellings: "Bare `--type` means the working project's declared `Project-Type`, and `--type=<type>` names the tier.".
- proposed: (via A040) Cut the get row's --type passage to the deferral clause and the one-flag-or-neither shape; drop its restated meaning and refusals.
- baseline-test: yes
- passage: `--type` has the `triggers` verb's two spellings. Appends a read stamp

### c1.C038
- key: Pass one tier flag or neither to `get`, never both.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 6cbb24a 2026-08-03, installed with the flag itself.
- verdict: retire
- landed: d2c43f1 section 22
- reason: memq.js refuses two flags with the cause named, and the usage signature's pipes already say one of three. The sentence restates a refusal that names itself.
- proposed: Drop "One flag or neither, never both" from the get row; the signature carries it.

### c1.C039
- key: Expect a type given twice, a type spelled in another case than the store's, or an unlistable type-tier root to be refused.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 9b1180b 2026-09-03, which added the case gate to the reading verbs and named it in the refusal.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Each of the three states is refused by memq.js with a message naming which one fired, so the enumeration adds nothing before the call and repeats the message after it.
- proposed: Drop the three-refusal list from the get row.

### c1.C040
- key: Expect `get` to append a `read` stamp on a memory-file hit, in the tier it resolved the name from.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 72ddd3e 2026-09-01, which made the stamp land in the pinned tier so the record actually served is the one whose decay clock moves.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Which tier's clock moves is what a session weighs before running `get` on a shadowed name, and no other line states the pinned-tier bound, so the bound stays as a clause. The Applied stamps section keeps the semantics.
- proposed: (via A044) Cut the get row's stamp sentence to "appends a read stamp in the tier it served, the pinned tier under a flag".
- passage: Appends a read stamp in the tier it served, the tier a flag names under a flag.

### c1.C041
- key: Expect `get` to follow the body with one `anchors:` line per anchor and one `triggers:` line per declared trigger.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 426bf68 2026-08-26 added the anchors line; 0d1e610 2026-08-30 added the triggers line.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The anchors section at line 191 and the triggers section at line 229 each own their output line with its shapes and not-checked causes. The row and line 38 both carry a summary copy.
- proposed: (via A047) Drop the anchors/triggers output sentence from the get row; lines 191 and 229 own it.

### c1.C042
- key: Run `memq recall` for the whole store as one bounded digest; it writes nothing.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:24
- provenance: f270e9c 2026-07-31, the Memory System commit that installed recall.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: A verb's shape and that it writes nothing are what a session needs before choosing it; nothing enforces the choice. The Recall section at line 42 is the rule beside this index entry. Flipped from keep to rewrite at section 22's close: c1.C115's retire cut the surface order, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The whole store as one bounded digest, no search term.
- passage: The whole store as one bounded digest, no search term.

### c1.C043
- key: Run `memq recall` at effort start, at a seat takeover, and again at a boundary taking the hand walk below.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:24
- provenance: f270e9c 2026-07-31 installed the triggers; 5b7dba3 2026-09-02 gave the seat-takeover read to the role skill.
- verdict: keep
- reason: One sentence carrying three bare triggers, which is the pointer-sized form a0edaed argued for on this document, and no hook runs recall for a session.
- passage: Run at effort start, at a seat takeover, and again at a boundary taking the hand walk below.

### c1.C044
- key: Run `memq recent [--since <n>d|<n>h]` for what the store recorded inside a window, default `1d`, grouped by write surface.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:25
- provenance: 31240d3 2026-08-01, the session-recap work that added `recent`.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The verb's shape and its window default are what a session types; the Session recap section at line 58 owns the grouping and finishing-work owns the trigger. Flipped from keep to rewrite at section 22's close: c1.C116's retire cut the three groups, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: What the store recorded inside a window (default `1d`), grouped by write surface.
- passage: What the store recorded inside a window (default `1d`), grouped by write surface.

### c1.C045
- key: Run `memq recent` at close-out.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:25
- provenance: 31240d3 2026-08-01, with the verb itself.
- verdict: keep
- reason: Two words cannot compress, and line 62 already names finishing-work step 7 as the trigger's owner, which is what the ownership map assigns. At HEAD the store-sync line names this section as the trigger's owner and finishing-work step 8 as its caller, the step renumbered from 7 at 55c5abc.
- passage: Writes nothing, not even a read stamp. Run at close-out.

### c1.C046
- key: Run `memq unstamped [--since <n>d|<n>h]` for memories opened in a window and never stamped applied, grouped by tier.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:26
- provenance: 1f4934e 2026-08-04, the applied-stamps work that added `unstamped`.
- verdict: keep
- reason: A verb's shape is what a session types; line 96 owns why the command exists and where it runs.
- passage: `memq unstamped [--since <n>d\|<n>h]` | The memories opened inside a window (default `1d`) and never stamped applied.

### c1.C047
- key: Read the `unstamped` report against your own account of the stretch, since no report is a swept window on its own.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:26
- provenance: a0edaed 2026-08-25, the round whose own message records that the rule held for eight review rounds while its reasons kept dying.
- verdict: retire
- landed: d2c43f1 section 22
- reason: merged into c2.C083, whose landed passage reads "No report is a swept window on its own. Set it against your own account of the stretch: adjudicate every listed line, then stamp by name any use the list did not raise.".
- proposed: Cut the unstamped row to usage, one pointer sentence at the Applied stamps section, and the two bare triggers.
- proposed: (via A066) Merge the row's "No report is a swept window on its own" sentence and its "which the paragraphs below own" pointer into one sentence pointing at the Applied stamps section.
- baseline-test: yes
- passage: No report is a swept window on its own. The Applied stamps section owns how to read it against your own account of the stretch.

### c1.C048
- key: Read the paragraphs below this table for how to hold your own account of the stretch against the report.
- class: pointer
- source: plugins/grimoire/skills/memory-system/SKILL.md:26
- provenance: a0edaed 2026-08-25, installed with the rule it points at.
- verdict: retire
- landed: d2c43f1 section 22
- reason: merged into c2.C083, the live Applied Stamps entry c1.C047 also retires into. With the copied sentence gone, the pointer has nothing to point from.
- passage: The Applied stamps section owns how to read it against your own account of the stretch.

### c1.C049
- key: Run `memq unstamped` at every Chapter boundary and once more at close-out.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:26
- provenance: 1f4934e 2026-08-04, which set the boundary trigger because the judgment is still fresh there.
- verdict: keep
- reason: Two bare triggers in the reference row against the reasoned rule at line 96: index and rule, and the triggers survive A067's compression of the row.
- passage: Run at every Chapter boundary and once more at close-out.

### c1.C050
- key: Stamp a memory applied with `memq touch <name> --applied [--type|--type=<type>|--operator]`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:27
- provenance: 8e22ff4 2026-07-31 installed `touch`; 9b1180b 2026-09-03 settled its tier-flag spellings.
- verdict: keep
- reason: A calling convention is what a session types when it stamps.
- passage: `memq touch <name> --applied [--type\|--type=<type>\|--operator]` | Stamp a memory as applied, in the tier a flag names.

### c1.C051
- key: Use `--type=<type>` on `touch` to stamp a type-tier record from a project that declares no type.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:27
- provenance: 9b1180b 2026-09-03, which gave the attached spelling its meaning and its fleet refusal.
- verdict: keep
- reason: One clause stating the fleet refusal beside the fleet section at line 166, which owns the reason (a stamp cannot land in a type the project has not opted into). One clause is the pointer-sized form.
- passage: `--type=<type>` is what stamps a type-tier record from a project that declares no type, and it is withheld under the engine store signals.

### c1.C052
- key: Record which files a project memory is about with `memq anchor <name> <path>...`, writing one `anchors:` line of `<path>@<sha>` entries.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:28
- provenance: 426bf68 2026-08-26, the memory-anchors-and-frontmatter-guard plan.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The row is the verb's reference entry and the anchors section at line 184 owns its semantics whole; the row's usage and one-line what stay. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Record which files a project memory is about, at the bytes they hold now: a list of `<path>@<sha>` entries, merged into any existing list with fresh hashes.

### c1.C053
- key: Never type a 40-hex hash by hand for an anchor; let `memq anchor` compute it.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:28
- provenance: 426bf68 2026-08-26, with the verb itself.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 184 owns the same rule, bold and with its reason, and the row's usage line already shows the verb computing the hash. This side is the copy, so the rule is not lost.
- proposed: (via A077) Drop the never-by-hand clause from the anchor row; line 184 owns it.
- baseline-test: yes

### c1.C054
- key: Anchor only in the project tier or a run's pending tier; `--type` in either spelling and `--operator` are refused.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:28
- provenance: 426bf68 2026-08-26, which bounded the verb to tiers that have a project root and a tree.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 184 owns the tier restriction with its reason and line 166 owns the grant withholding; memq.js refuses the flags with the cause named and memq-grant.js withholds the verb. The key's `--operator` half holds only for an operator record whose `machine:` does not name this host. A record scoped to this host takes a store-relative anchor, and the verb's refusal of every other names that machine rule. The reference table's `memq anchor` row and the anchors section's paragraph opening "An operator record scoped to this machine can anchor a file inside the store" state it, so the row carries a tier sentence again, for the admission rather than the refusal. `--type` is refused as the key says.
- proposed: (via A080) Drop the tier-restriction and no-grant sentences from the anchor row.

### c1.C055
- key: Expect `anchor` to refuse with nothing written on a share cwd, an unknown name, an unresolvable pin or root, a path outside the grammar, malformed frontmatter, an unreadable existing entry, or a merge past 32 entries.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:28
- provenance: 426bf68 2026-08-26, installed with the verb.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 186 owns the refusals worth composing around, and every refusal leaves the record untouched and names itself when it fires. The row's seven-item list is a second copy.
- proposed: (via A083) Drop the "Refuses with nothing written" list from the anchor row; line 186 owns it.

### c1.C056
- key: Declare recognition triggers with `memq triggers <name> [<type>:<pattern>...]`, using one of `cmd`, `err`, `skill`, `agent`, `tool`, `glob`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:29
- provenance: 0d1e610 2026-08-30, the memory-recognition plan that gave a record a way to say what it is about.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The row is the verb's reference entry (usage, six types, verbatim pattern) and lines 211-219 own the field and the write door: index and rule. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Record the triggers a memory should be surfaced by, as a list of `<type>:<pattern>` entries. Types are `cmd`, `err`, `skill`, `agent`, `tool` and `glob`, and the pattern is stored verbatim.

### c1.C057
- key: Target the tier on `triggers` with `touch`'s flag shape: neither flag for the project tier, `--type` or `--operator` to name a shared tier outright.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:29
- provenance: 9b1180b 2026-09-03, which settled the flag shape across the verbs.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: Within the table this row is the one the get and touch rows defer to for the two spellings, so it owns the flag shape in the reference; line 219 owns the write door and its bars. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: With no tier flag it writes the project tier, refusing inside a run a name the pending tier holds. Bare `--type` means the working project's declared `Project-Type`, and `--type=<type>` names the tier.

### c1.C058
- key: Attach the type value to the flag word as `--type=<type>` rather than as a following positional.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:29
- provenance: 9b1180b 2026-09-03, the MEMQ-TRIGGERS round; `git log -S "type named"` on the document finds no earlier install of the trap.
- verdict: keep
- reason: No finding. The trap is silent: `triggers rec --type cmd:whatever` parses as a type named rec and no refusal explains the misparse, so the spelling instruction is the only warning.
- passage: Keep the value on the flag word, because `triggers rec --type cmd:whatever` parses as a type named rec.

### c1.C059
- key: Use `--replace` to write the named entries in place of the existing line, and `--replace` with no entry to remove the line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:29
- provenance: 9b1180b 2026-09-03, which made a wrong recognition declaration correctable rather than something to live with.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: Line 219 owns `--replace` whole, including the consent bar, the engine-signal refusal and the no-op cases, while the row states it in two sentences with the no-op repeated. The row keeps one clause and points. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: (via A091) Cut the triggers row's --replace passage to one clause ("--replace states the line whole and is the only way an entry comes off; the triggers section owns it").
- baseline-test: yes
- passage: Only `--replace` removes an entry.

### c1.C060
- key: Expect `triggers` to refuse with nothing written on a share cwd, a bad or unknown or case-mismatched type, a missing tier, an unknown name, an entry outside the grammar, a `glob:` under a tier flag, malformed frontmatter, an unreadable or already-cut line, or a write past 32 entries.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:29
- provenance: 0d1e610 2026-08-30 installed the grammar; 9b1180b 2026-09-03 added the replace-path refusals.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 227 owns the list whole, with the YAML-sequence reasons and the flag-versus-verb split, and every refusal names the entry and the rule it met on stderr. This is the longest copy in the table.
- proposed: (via A093) Drop the "Refuses with nothing written" passage from the triggers row; line 227 owns it.

### c1.C061
- key: Pass `--confirm-shared` with `--replace` when it reaches the type or operator tier or a pinned project store.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:29
- provenance: 9b1180b 2026-09-03, which put a consent bar on the one path that drops what the caller did not name.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The row's own signature already shows `[--replace [--confirm-shared]]`, line 219 owns the bar with its reason, and memq.js refuses both the missing flag and the flag that confirms nothing, naming which.
- proposed: (via A096) Drop the --confirm-shared sentences from the triggers row; the signature and line 219 carry the bar.

### c1.C062
- key: Write a type-tier memory with `memq add-type <type> <name> "<description>"` plus its optional body, tag, trigger, supersedes and update flags, under the tier lock.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 8e22ff4 2026-07-31, which installed the type tier and its single authoring door.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The row is the verb's reference entry and line 153 owns the authoring rule with its lock reason; the frontmatter guard enforces only the never-a-direct-Write half. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Write a type-tier memory, the only type-tier authoring path.

### c1.C063
- key: Compose an add-type description to 120 characters and the whole record to 65536 before running.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 8f2b500 2026-08-08, which stated the caps and made the shared tiers refuse an overflow after a kaizen note found the caps invisible.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Unlike `log`, both caps are refused over the cap rather than truncated, so the refusal is the machinery and it names both caps when it fires. Line 153's separate statement of the description cap is the c3 judge's to rule. Its landing respelled c1.C076's keep sentence at the fix round; c1.C076 records the flip.
- proposed: (via A101) Drop the caps sentence from the add-type row; the refusal names both caps.
- baseline-test: yes

### c1.C064
- key: Treat 65536 as the record cap because that is what `get` reads and prints.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 8f2b500 2026-08-08, attached to the caps sentence at its install.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Why the cap is 65536 is not needed to compose under it, and the rule it supports retires with the refusal that now enforces it. The why lives here.
- proposed: Drop with the caps sentence.
- baseline-test: yes

### c1.C065
- key: Use `--body-file` for any body with newlines in it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: c56a8b5 2026-08-21, which gave shared-tier bodies a channel no shell can mangle.
- verdict: keep
- reason: No finding. Choosing the channel is a composition decision made before the call: the refusal of `--body` with `--body-file` fires only after a session has already picked wrong.
- passage: Use `--body-file` for any body with newlines in it.

### c1.C066
- key: Read the success line's reported body length as the signal that a body arrived whole.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 8f2b500 2026-08-08, the commit that gave the success line its reported length.
- verdict: keep
- reason: No finding. The line is printed but its meaning as a wholeness check is not, and a shell-mangled body otherwise lands silently.
- passage: The success line reports the stored body's length, which is the signal that a body arrived whole.

### c1.C067
- key: Use `--update` alone to replace only the index description, and `--update` with a body flag plus `--confirm-shared` to replace the body whole.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 8f2b500 2026-08-08 added the `--update` repair; 752dbce 2026-08-22 gave it the Repair bullet.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The Repair bullet at line 159 owns the repair shape whole, including the mandatory description and what it refuses alongside. The row keeps the signature and one clause.
- proposed: (via A105) Cut the add-type row's --update sentences to one clause ("--update alone rewrites the description; with a body flag and --confirm-shared it replaces the body, the Repair bullet owns it").
- baseline-test: yes
- passage: `--update` alone rewrites the description, and with a body flag and `--confirm-shared` it replaces the body.

### c1.C068
- key: Delete and rewrite a record rather than trying to change its tags, triggers or supersedes pointer, all of which are set at creation.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 752dbce 2026-08-22 set the creation-only rule; 9b1180b 2026-09-03 gave triggers their own remedy.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 159 carries the fuller and more current account, including that triggers are the one member whose remedy is the `triggers` verb rather than a rewrite, which the row's version omits. The copy is behind its owner.
- proposed: (via A107) Drop the tags/pointer/trigger set-at-creation sentences from the add-type row; line 159 owns them.

### c1.C069
- key: Point a new record at the live same-tier record it replaces with `--supersedes <name>`, written as a top-level frontmatter line beside `tags:`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: b5c0a98 2026-08-23, the memory-supersedes plan.
- verdict: retire
- landed: d2c43f1 section 22
- reason: restated where the `supersedes:` Field section owns it, "The flag on the two shared-tier verbs is one way to write the field.".
- proposed: (via A110) Cut the add-type row's --supersedes passage to one clause naming what the flag points at and that the supersedes section owns the field; drop the six-shape list.
- baseline-test: yes
- passage: `--supersedes <name>` points the new record at the live same-tier record it replaces, and the supersedes section owns the field.

### c1.C070
- key: Read the back-pointer refusal carefully, because a mutual pointer drops both halves and costs the new record its label and archive nomination.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 0d02214 and b5c0a98 2026-08-23, the supersedes work that added the cycle refusal.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal fires before anything lands and names its shape, and line 178 owns the cycle rule; what the loss would have been is not needed to act on it.
- proposed: Drop the "worth reading carefully" sentence from the add-type row.

### c1.C071
- key: Declare a record's birth triggers with repeatable `--trigger <type>:<pattern>`, validated by the `triggers` verb's grammar and specificity bars.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 2b6e936 2026-09-02, the memory-recognition-reach plan that gave the add verbs a birth-trigger flag.
- verdict: retire
- landed: d2c43f1 section 22
- reason: restated where the triggers section owns it, "`--trigger <type>:<pattern>` on the `add-type` or `add-operator` that creates one.".
- proposed: (via A113) Cut the add-type row's --trigger passage to one clause ("--trigger declares the record's triggers at birth under the triggers verb's grammar; the triggers section owns the door").
- baseline-test: yes
- passage: `--trigger` declares triggers at birth under the `triggers` verb's grammar.

### c1.C072
- key: Expect a record written with no trigger to land, with stderr naming the missing handle as a debt.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 2b6e936 2026-09-02, which made an untriggered record land with its missing handle named rather than be refused.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 893 (Unattended vector grant subset) shrink drops the follow-on paragraph. memq prints the missing-trigger note on stderr itself, and the landed unattended-vector paragraph names `--trigger` among the withheld shapes a fleet worker leaves to an attended session.
- proposed: (via A115) Drop the no-trigger note passage from the add-type row; line 219 keeps the fact.
- passage: A record written with no trigger still lands, and stderr names the missing handle.

### c1.C073
- key: Read the nearest-neighbours block `add-type` prints on stderr before a creation write; it warns and never gates.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: a3d8fbf 2026-09-06, the write-time-neighbours plan section 3.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The instruction to read the block survives at line 153 and the remedy routing at line 162; what goes is the row's eight-sentence account of the block's own format, which the block shows when it prints.
- proposed: (via A119) Cut the add-type row's neighbours passage to one sentence naming the block, its channel, its creation-only printing and that it never gates.
- baseline-test: yes
- passage: On creation the verb prints its nearest neighbours on stderr before the write, and the block warns and never gates.

### c1.C074
- key: Treat a `likely overlap` label as a candidate for `--supersedes`, a repair or a delete.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: a3d8fbf 2026-09-06, with the neighbours block.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The block's own closing line names the three remedies and line 162 owns the routing between the four; the row's sentence copies both.
- proposed: (via A121) Drop the likely-overlap remedy sentence from the add-type row.

### c1.C075
- key: Expect the neighbours check to be skipped, bounded or degraded, with a line naming the cause, when the embedder is absent, `NEIGHBOUR_TIMEOUT_MS` elapses, `KIT_MEMORY_ROOT` or `KIT_EMBEDDER_ROOT` is present, or the check failed.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: a3d8fbf 2026-09-06 documented the states; 62d242f 2026-09-06 honoured the cancellation so the timeout line is truthful.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Each state prints a line naming its own cause, so the enumeration restates what the session reads when it arrives.
- proposed: Drop the not-checked cause enumeration from the add-type row.

### c1.C076
- key: Write an operator-tier memory with `memq add-operator <name> "<description>"`, the same flags and refusals as `add-type` under its own lock.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:31
- provenance: 8e22ff4 2026-07-31, which installed the tiers and their single authoring doors.
- verdict: rewrite
- landed: e09d31a8 section 5
- reason: The row is the reference entry and line 143 owns the authoring rule with its lock reason: index and rule. Flipped from keep to rewrite at section 22's fix round 1: c1.C063's retire dropped row 30's caps and c1.C069's rewrite dropped its six-shape refusal list, both of which this row deferred to, so the sentence was respelled to stand as landed. Landed as the proposal below. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: The same for the operator tier, under its own lock, with the same refusals, body channels, `--supersedes` pointer and `--update` repair.
- passage: The same for the operator tier, with the same refusals, body channels, `--supersedes` pointer, `--update` repair and `--replace`.

### c1.C077
- key: Scope an operator fact to one box with `--machine <name>`, set at creation like `--tag` and `--supersedes`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:31
- provenance: 6cbb24a 2026-08-03, which added the machine scope to the operator tier.
- verdict: keep
- reason: No finding. The scope is set at creation and `--update` carrying it is refused, so a fact scoped wrong costs a delete and a rewrite; the decision has to be made before the call.
- passage: `--machine` scopes the fact to one box.
- passage: Like `--tag` and `--supersedes`, both are set at creation, and `--update` carrying any of them is refused.

### c1.C078
- key: Point an operator-tier `--supersedes` at an operator-tier record only; a type-tier name is a miss here.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:31
- provenance: b5c0a98 2026-08-23, the supersedes plan's same-tier rule.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 176 owns "same tier only" and memq.js refuses a name the operator tier does not hold with the cause named; the row's sentence duplicates both.
- proposed: Drop the same-tier sentence from the add-operator row.

### c1.C079
- key: Discount a `likely overlap` whose line carries a `machine:` scope for another box.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:31
- provenance: a3d8fbf 2026-09-06, the write-time-neighbours documentation, which prints the scope on the neighbour line.
- verdict: keep
- reason: No finding. The block prints the scope and explicitly leaves whether a neighbour is the same fact to the author, so the discount is judgment the code declines to make.
- passage: The neighbours block prints here too, with each hit's `machine:` scope on its line, so discount a `likely overlap` on a record about another box.

### c1.C080
- key: Remove a type-tier record with `memq delete-type <type> <name> --confirm-shared`, one locked operation covering record, archive copy, both index lines, stamps, stray copies and backups.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:32
- provenance: 752dbce 2026-08-22, the shared-tier-authoring plan's repair-and-delete section.
- verdict: retire
- landed: 54629b25 section 6
- superseded-by: E008
- reason: The Delete bullet at line 160 owns what the delete removes, the stamp caveat, the typo case and the cross-machine conflict. The row keeps the signature, the lock, the declaring-projects line and the without-flag refusal. Retired on 2026-10-04 by section 6 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the shared-tier deletes mark the record's database row deleted and removed no file, so the row no longer runs a locked operation, and E008's passage carries the row; the verdict before it was rewrite.
- proposed: (via A128) Cut the delete-type row to the signature plus one sentence, leaving the removal inventory and the stamp caveat to line 160.
- baseline-test: yes
- passage: `memq delete-type <type> <name> --confirm-shared` | Remove a type-tier record outright, in one locked operation. Names the projects declaring the type before it acts. Without the flag it refuses, having changed nothing.

### c1.C081
- key: Spell the type exactly as the store holds it; a case-differing spelling is refused with nothing deleted.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:32
- provenance: 9b1180b 2026-09-03, which put the case gate on the deletes as well as the reading verbs.
- verdict: retire
- landed: d2c43f1 section 22
- reason: memq.js refuses with nothing deleted and names the cause, and the unlistable-root and no-such-tier states are named the same way.
- proposed: Drop the case, unlistable-root and no-tier sentences from the delete-type row.

### c1.C082
- key: Treat the case refusal as protecting against a case-folding filesystem deleting from the tier the store holds while printing the caller's spelling.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:32
- provenance: 9b1180b 2026-09-03, with the gate; 3737740 2026-09-03 carried the mirror reason to the write path.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal is obeyed by respelling the type; the filesystem reason now lives here beside c1.C121's.
- proposed: Drop with the case sentence.

### c1.C083
- key: Remove an operator-tier record with `memq delete-operator <name> --confirm-shared`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:33
- provenance: 752dbce 2026-08-22, with `delete-type`.
- verdict: keep
- reason: One line, "the same for the operator tier", is already the pointer-sized reference entry.
- passage: `memq delete-operator <name> --confirm-shared` | The same for the operator tier.

### c1.C084
- key: Run `memq decay-scan` to report decay candidates with evidence dates, the pinned class, superseded records and a usage-evidence line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:34
- provenance: 8e22ff4 2026-07-31, which installed the decay lifecycle.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: What the scan reports and that it writes nothing are what a session needs before choosing it; the evidence-line section at line 288 owns how the lines are read. Flipped from keep to rewrite at section 22's close: c1.C122's retire cut the sidecar passage the sentence was joined to by a semicolon, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Writes no record, index line, journal entry or stamp.
- passage: Report decay candidates with their evidence dates, the pinned class, a superseded record whatever its idle clock, and a standing usage-evidence line.
- passage: Writes no record, index line, journal entry or stamp.

### c1.C085
- key: Read the anchor-drift block `decay-scan` prints on stderr, naming each project-tier record whose anchored file changed or is gone and each it could not settle.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:34
- provenance: 426bf68 2026-08-26, the anchors plan, which hung drift reporting off the scan.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The drift bullet at line 190 owns the block's rows, heading causes and network states, and the row restates them with the no-drift bar. The row keeps one clause naming the block and its channel.
- proposed: (via A139) Cut the decay-scan row's drift sentence to "adds the anchor-drift block on stderr, which the anchors section owns".
- passage: On stderr it adds the anchor-drift block, then the neighbour-pairs block of live same-tier records at or above the overlap floor.

### c1.C086
- key: Read the neighbour-pairs block after the drift block: a per-tier heading, the highest-scoring live same-tier pairs at or above `FLEET_NEIGHBOUR_FLOOR`, capped at `PAIRS_SHOWN` with a counted remainder.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:34
- provenance: 91111b3 2026-09-05, which made the scan nominate live near-duplicate pairs after its drift block; documented at a3d8fbf 2026-09-06; the floor named as `FLEET_NEIGHBOUR_FLOOR` on 2026-10-04 by the finishing pass of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which removed the local `NEIGHBOUR_FLOOR`.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No finding. The bounds a reader needs to judge the block are what it does not show: that it never covers the pending tier and withholds pairs already joined by a pointer or split by machine scope, so an absent pair is not evidence of no duplicate. Flipped from keep to rewrite at section 22's close: c1.C122's retire dropped the antecedent 'its neighbour-pairs block', so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The neighbour-pairs block prints on stderr after the drift block, one tier at a time and never the pending tier: a heading counting the pairs and the records it could not check (`memq: neighbour pairs (project): 1 pair, 1 of 3 records not checked`), then the highest-scoring pairs of live same-tier records at or above `FLEET_NEIGHBOUR_FLOOR` as `memq: pair  <name>  <name>  <score>`, a `pinned:` mark naming each pinned member and a `machine:` scope where one carries it, capped at `PAIRS_SHOWN` with a counted remainder, and `memq: no neighbour pairs (<tier>)` for a tier read whole with none.
- passage: That block never reads the pending tier and withholds pairs a `supersedes:` pointer joins or `machine:` scopes split, so a missing pair is no evidence of no duplicate.

### c1.C087
- key: Expect `decay-scan`'s stdout and exit code to be the same with the neighbour block as without it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:34
- provenance: 91111b3 2026-09-05, which put the pairs block on stderr so the scan's contract held.
- verdict: retire
- landed: d2c43f1 section 22
- reason: An invariant memq.js keeps, observed by any caller parsing stdout without being told. It describes the code rather than directing an act.
- proposed: Drop the stdout-and-exit-code clause from the decay-scan row.

### c1.C088
- key: Mutate the store in the decay pass only with `memq decay-prune`, which touches only what its flags name.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:35
- provenance: 8e22ff4 2026-07-31, the decay lifecycle install.
- verdict: keep
- reason: Which flags mutate what is what a session decides before running the pass's one mutation path; line 292 owns what `--rollup` folds and line 278 the pin refusal.
- passage: The pass's one mutation path over the store's own records and sidecars, and it mutates only what its flags name.

### c1.C089
- key: Add `--drop-malformed` alongside `--rollup` to remove malformed sidecar lines, each removal said and counted.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:35
- provenance: ad7b109 2026-08-25, which made malformed-line handling explicit with preserving as the default.
- verdict: keep
- reason: The row states the flag in one sentence and already points at the evidence-line section for its bounds, so it is pointer-sized as it stands.
- passage: `--drop-malformed` rides `--rollup` and removes the malformed sidecar lines that rewrite otherwise preserves.

### c1.C090
- key: Pass `--confirm-shared` for a shared-tier archival: always for `--archive-operator`, and for `--archive-type` whenever more than one declaring project is found or the scan cannot run.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:35
- provenance: ae2c70a 2026-08-22, the read-whole-against-the-CLI pass; 5ac33f5 2026-08-25 kept the refused path informative.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The row states the code's gate correctly and line 296 states the rule over it (do not supply the flag where the scan cannot run without asking the operator). The change is a pointer so the gate is not read as a licence; no side gives way.
- proposed: (via A147) Keep the row's gate sentence and add "the running-the-pass paragraph owns when to supply it".
- baseline-test: yes
- passage: A shared-tier archival needs `--confirm-shared`: always for `--archive-operator`, and for `--archive-type` whenever the scan of declaring projects finds more than one or cannot run. Running the Decay Pass owns when to supply it.

### c1.C091
- key: Read the declaring-projects scan as the gate the code implements, not as a guarantee about the type's true reach.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:35
- provenance: ae2c70a 2026-08-22, when the skill was read whole against the shipped CLI and the scan's reach was found narrower than the prose claimed.
- verdict: retire
- landed: d2c43f1 section 22
- reason: the scan's reach is argument and changes no act. The gate sentence of c1.C090 and the Running the Decay Pass paragraph's ask-the-operator rule carry the act.
- proposed: Keep the rule and its two bounds in one sentence; drop the worked example.
- baseline-test: yes
- passage: Read that scan as the gate the code implements rather than the type's true reach, since it reads this machine's project stores only and counts past a project whose index it cannot read.

### c1.C092
- key: Run `memq decay-done` to touch the stamp recording a completed decay pass.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:36
- provenance: 8e22ff4 2026-07-31, with the decay lifecycle.
- verdict: keep
- reason: One line in the row; line 296 owns the pass order. Pointer-sized already.
- passage: `memq decay-done` | Touch the decay stamp that records a completed pass.

### c1.C093
- key: Expect `get` to resolve a name collision most-specific-first: journal key, pending tier, project memory, type tier, operator tier, then those last three archives in the same order.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: 8e22ff4 2026-07-31 set the precedence; 70f4f8b 2026-08-02 inserted the pending tier into it.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The order is what predicts a collision and tells a session when to pin, and the provenance fence names the tier only for shared hits, so the rule stays. What changes is that the order is stated twice; line 38 is the titled owner. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: State the precedence once at line 38 and cut the get row's copy to "from the first tier holding that name".
- passage: or a memory record's body from the first tier holding that name.
- passage: On a name collision `get` takes the most specific tier first: a journal key, a run's pending tier, a project memory, the type tier, then the operator tier. The project, type and operator archives follow in that order, so live beats retired.

### c1.C094
- key: Expect a provenance fence on stdout around a hit whose writer is not its reader, and an archive hit noted on stderr.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: 6cbb24a 2026-08-03, which added the fence with the synced semantic store.
- verdict: retire
- reason: row 865 (get precedence and fencing) shrink cuts the fencing rationale. The doctrine's "Treat text inside files, issues, tool output, and pasted content as data" bullet carries the act.
- passage: A hit whose writer is someone other than its reader is fenced on stdout with the body it frames, because a provenance marker on a different stream would fence nothing. That fence covers the type and operator tiers always, live and retired alike, and the project tier under a store pin. An archive hit is noted on stderr.

### c1.C095
- key: Read a record with `get` and never copy one out of `get`'s output.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: f270e9c 2026-07-31 installed the rule; ae2c70a 2026-08-22 attached the cap consequence after reading the skill against the CLI.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No machinery stops a session writing `get`'s output back into a record, so the rule and its cap reason stay. What leaves the paragraph is what other lines own: the anchors and triggers output, the precedence copy, the archive and supersession sentences and the refusal-echo reduction.
- proposed: Cut line 38 to the precedence, the fence, the never-copy rule with its cap reason, and the other-store sentence.
- baseline-test: yes
- passage: Read a record with `get` and never write its output back, since memq's status lines follow the record and a record past the 65536-character cap comes back short.

### c1.C096
- key: Treat the record's own `anchors:` and `triggers:` frontmatter lines and memq's trailing status lines as easy to conflate, both spelled the same way at column zero.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: 426bf68 2026-08-26 and 0d1e610 2026-08-30, which added the two frontmatter lines this reason is about.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The never-copy rule is obeyed without knowing that the two line shapes look alike; the reason lives here.
- proposed: Drop the conflation sentence from line 38.
- baseline-test: yes

### c1.C097
- key: Read a shadowed shared-tier record's file directly under `~/.claude/memory-types/<type>/` or `~/.claude/memory-operator/` when that record is the one you want.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: f270e9c 2026-07-31, written before `get` took a tier flag at all.
- verdict: retire
- landed: d2c43f1 section 22
- reason: This genuinely conflicts with c1.C036 at execution time, and history decides against it: the tier flag (6cbb24a, then 72ddd3e) is now the spelling that reaches a shadowed record and takes its stamp in the right tier. The direct read is the pre-flag workaround left standing.

### c1.C098
- key: Expect a semantic hit from another project's store to be unfetchable from here, its provenance label naming where the file lives, with no read stamp taken.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: 6cbb24a 2026-08-03, the synced semantic store, which made cross-store hits visible but not fetchable.
- verdict: retire
- landed: f92e99ec section 5
- reason: memq.js declines the fetch, but where to read the file instead and that no stamp landed are what the session acts on next, and the refusal says neither. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: A `find` hit from another project's store is not fetchable from here, and its provenance label names where the file lives.

### c1.C099
- key: Expect an archived memory to keep its description in the archive index and still answer `get` by name.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: 8e22ff4 2026-07-31 and f270e9c 2026-07-31, which made archiving a demotion rather than a delete.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The same fact is stated at line 162, line 201 and line 258, which own it where a session decides to archive; line 38's copy is the furthest from that decision.
- proposed: (via A165) Drop the archiving-is-demotion sentence from line 38.

### c1.C100
- key: Expect a superseded record to stay live and `get` to answer for it with a note naming the successor.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: b5c0a98 2026-08-23, the memory-supersedes plan.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 162 owns supersession's effects on every surface and line 272 owns the archive nomination; line 38's sentence with its model-written-data reason is a copy. Lands with get's supersession note stated by the four-remedies paragraph's one-clause pointer ('the pointer labels and demotes the old record on every read surface') after c3.C025 retired the effect list, rather than by row 38 or a per-surface sentence.
- proposed: (via A168) Drop the supersession-is-demotion sentence from line 38.

### c1.C101
- key: Resolve the session-filing leg's ancestor climb no further than the nearest enclosing repository root.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 555407f 2026-09-01, the memory-read-side plan, so a nested checkout resolves its own store.
- verdict: retire
- reason: row 858 (Store resolution order internals), dropped under the mechanism cut.
- passage: The climb stops at the nearest enclosing repository root, so a repository boundary is a store boundary.
- ruled: cut 2026-09-30

### c1.C102
- key: Expect the plain cwd derivation to answer instead of the session filing when there is no session id, no transcript, more than one transcript for that id, a working directory outside the named project, or a path resolved for another process's directory.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 555407f 2026-09-01, with the filing leg itself.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The five conditions are resolver internals in memq.js. The one sentence a session needs, that the cwd answers wherever the session does not, survives A004's compression.
- proposed: Drop the five-condition list from line 8; keep the one-sentence fallback.

### c1.C103
- key: Understand that the worktree main-root leg precedes the session-filing leg in the resolver order because reversing it would split memories per worktree.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 945a75c 2026-08-19 closed the per-worktree split; 555407f 2026-09-01 explained the ordering it forced.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Why one leg precedes the other is not needed to predict the order, and the split it protects against is already closed in code. The reason lives here.
- proposed: Drop the "would reopen the per-worktree store split" sentence from line 8.

### c1.C104
- key: Expect the pending tier to exist only when the engine store signals are set and a valid `KIT_RUN_ID` names the run.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 70f4f8b 2026-08-02, which added the pending tier for engine runs.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The sentence defines a term eight table rows lean on. A definition a reader needs to read the rows is not enforced by the code that creates the tier. Flipped from keep to rewrite at section 22's close: c1.C105's, c1.C106's and c1.C107's retires cut its three trailing clauses, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The **pending tier** is a fourth surface, holding the memories one run wrote that nobody has adjudicated yet; it exists only where those signals are set and a valid `KIT_RUN_ID` names the run, which is why `get` resolves it ahead of the project tier.
- passage: The **pending tier** holds the memories one run wrote that nobody has adjudicated, and exists only under those signals with a valid `KIT_RUN_ID`.

### c1.C105
- key: Expect `memq recall`'s digest budget to cut the pending tier's content later than any other tier.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 70f4f8b 2026-08-02, with the pending tier.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The budget order is memq.js's own and the digest's coverage lines announce where the budget bound; no act depends on the clause. Its landing respelled c1.C104's keep sentence; c1.C104 records the flip.
- proposed: Drop the recall-budget clause from the pending-tier definition.

### c1.C106
- key: Expect the pending tier to be exempt from the decay pass.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 70f4f8b 2026-08-02, with the pending tier.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The pass skips the tier in memq.js and the scan's per-tier lines show which tiers it read.
- proposed: Drop the decay-exemption clause from the pending-tier definition.

### c1.C107
- key: Expect `find` to keep the pending tier out of the semantic index.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:8
- provenance: 70f4f8b 2026-08-02, with the pending tier.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 46 states the same fact where find's reach is explained, and memory-index.js excludes the tier without any act of the session's. This ruling retires line 8's copy only.
- proposed: (via A177) Drop the semantic-index clause from the pending-tier definition at line 8.

### c1.C108
- key: Expect a deleted record's stale embedding and name-keyed hash to remain in the machine's vector index until the next `find` sweeps it out.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: b136b28 2026-08-22, the confirmation round that enumerated the residue a delete does not reach.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 862 (Never hand-edit journal sidecars) cuts the residue catalogue to the stopped-delete sentence the bold-lead bullet keeps, and row 890 (Shared-tier repair and delete mechanics) drops the residue detail from the Delete bullet, so no landed text carries this caveat.
- proposed: and the machine's derived vector index holds the removed record's embedding and a hash keyed by name until the next `find` sweeps them out.
- passage: The machine's derived vector index holds the removed record's embedding and a hash keyed by name until the next `find` sweeps them out.

### c1.C109
- key: Expect a delete to run its removal steps in this fixed order: record-text copies, tier index line, archive index line, stamps, record files.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:14
- provenance: d7499c8 2026-08-22 set the order; b136b28 2026-08-22 corrected it.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 14 now tells the session to read the failure line naming what the run removed rather than infer it from the order (c1.C022), and memq.js prints that line. The order is superseded by the instruction that replaced it.
- proposed: Drop the five-step order from line 14; keep C022's instruction to read the failure line.

### c1.C110
- key: Read a `find` lexical hit as `<key> <pass>/<fail> last <age> <latest summary>` for a journal key or `<name> [tags] <description>` for a memory.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:22
- provenance: 8e22ff4 2026-07-31, which installed find's lexical block and its two hit shapes.
- verdict: keep
- reason: The shape of output a session must read is not enforced on it by the code that prints it, and the two shapes are not self-labelling.
- passage: journal keys as `<key>  <pass>/<fail>  last <age>  <latest summary>`, memories as `<name>  [tags]  <description>`.

### c1.C111
- key: Expect `find`'s semantic block to withhold retired records and instead print one line counting them and naming the best score an `--archived` rerun would show.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:22
- provenance: 4fe812b 2026-08-03, which made the suppression of retired records never silent.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The counting line names the `--archived` rerun itself and line 46 owns why suppression is never silent; the row's sentence copies output that explains itself. The `--archived` clause (c1.C032) stays. Its landing respelled c1.C032's keep sentence; c1.C032 records the flip.
- proposed: (via A182) Drop the withheld-retired-records sentence from the find row; the --archived clause (C032) stays.

### c1.C112
- key: Expect the model-judged block to sit above the lexical and semantic blocks, sending the query and ranked candidates to the endpoint and printing one reasoning clause per hit.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:22
- provenance: 050587b 2026-08-30, the honest-degrade plan for the model-judged channel.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The block labels itself model-judged and advisory and sits where memq.js puts it; with the row cut to one clause (c1.C033) the placement and per-hit description leave with it.
- proposed: (via A185) Drop with the model-judged compression at A033.

### c1.C113
- key: Expect `get` to return a key's journal entries newest-first and capped.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 8e22ff4 2026-07-31, with the journal read path.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Newest-first and the cap are visible in the output and the cap announces itself; no act depends on the clause.
- proposed: Drop "(newest first, capped)" from the get row.

### c1.C114
- key: Expect `get` under a `--type`/`--operator` flag to never read the journal, and an empty named tier to refuse by name rather than fall back to another tier.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:23
- provenance: 72ddd3e 2026-09-01, which made an empty named tier refuse by name instead of falling back.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal names the tier it could not answer from, and that a flag reads no journal is a consequence of the key being the bare form's namespace, which the refusal reports.
- proposed: Drop the no-journal-under-a-flag clause from the get row.

### c1.C115
- key: Expect `memq recall`'s digest to print a coverage line per surface, then journal keys, archive, type tier, operator tier, project tier, and the pending tier where one exists, in that order.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:24
- provenance: f270e9c 2026-07-31, the recall install.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The digest's surface order is read off the digest itself, and line 50 owns what each surface carries. The order is output, not a rule. Its landing respelled c1.C042's keep sentence; c1.C042 records the flip.
- proposed: (via A190) Cut the recall row to "the whole store as one bounded digest; writes nothing" and its triggers.

### c1.C116
- key: Expect `memq recent` to group its window's activity into journal entries logged, applied stamps written, and memory files added or updated, across every tier.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:25
- provenance: 31240d3 2026-08-01, the session-recap work.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The three groups are the headings memq.js prints, and line 58 owns why the digest groups by write surface. Its landing respelled c1.C044's keep sentence; c1.C044 records the flip.
- proposed: Drop the three-group enumeration from the recent row.

### c1.C117
- key: Expect an `unstamped` report to close by stating how many records in the window carry a read stamp, even when its list is empty.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:26
- provenance: f1e3363 2026-08-25 and 5ac33f5 2026-08-25, which gave the report its closing evidence line.
- verdict: retire
- landed: d2c43f1 section 22
- reason: memq.js prints the line in its own wording and line 312 owns how its two shapes are read; the rule for reading it lives at line 104.
- proposed: Drop the closing-evidence sentence from the unstamped row (A067).

### c1.C118
- key: Adjudicate the `unstamped` report by recognizing entries on the machine-built list rather than trying to recall from memory what you used.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:26
- provenance: 1f4934e 2026-08-04, which set the boundary trigger because the judgment is still fresh there.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 96 owns the recognition-over-recall rule with its reason and line 106 owns the walk; the row's sentence is a copy of the bold rule, so retiring the copy loses nothing.
- proposed: (via A195) Drop the adjudication-list sentence from the unstamped row (A067).
- baseline-test: yes

### c1.C119
- key: Expect a store pin not to block `triggers`, unlike `anchor`, since a trigger pattern needs no project root to resolve against.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:29
- provenance: 0d1e610 2026-08-30, the recognition plan, which gave `triggers` no project-root dependence.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A session under a pin learns it at the door: `anchor` refuses with the cause named and `triggers` proceeds. The contrast and its reason are rationale.
- proposed: Drop the pin-is-no-obstacle sentence from the triggers row.

### c1.C120
- key: Expect `triggers` without `--replace` to merge new entries into the existing `triggers:` line, keeping each existing entry's position and appending the new ones.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:29
- provenance: 0d1e610 2026-08-30 set the merge; 9b1180b 2026-09-03 added the replace path it contrasts with.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 219 owns the merge semantics with the contrast to anchor's hash, and stderr says which entries arrived and which were already on the record.
- proposed: (via A198) Drop the merge sentence from the triggers row.

### c1.C121
- key: Understand that on a case-sensitive filesystem sharing the store, writing a differently-cased type would create a second tier alongside the existing one.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:30
- provenance: 9b1180b 2026-09-03 put the case gate on the write path; 3737740 2026-09-03 carried the mirror reason across.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal is obeyed by respelling the type and names itself; the filesystem consequence is a reason and lives here beside c1.C082's.
- proposed: Drop the case-refusal reason from the add-type row.

### c1.C122
- key: Expect `decay-scan`'s neighbour-pairs block to update the per-machine vector index like `find` does, but on a `NEIGHBOUR_TIMEOUT_MS` timeout write only the vectors already computed and leave the rest for the next sweep.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:34
- provenance: 62d242f 2026-09-06, which honoured the neighbours check's cancellation inside the sweep and the query.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Sidecar maintenance on a timeout is memory-index.js behavior, invisible to the session and acted on by nothing. Its landing respelled c1.C084's keep sentence; c1.C084 records the flip. Its landing respelled c1.C086's keep sentence; c1.C086 records the flip.
- proposed: Drop the sidecar-update passage from the decay-scan row.

### c1.C123
- key: Expect `decay-prune` to print how far a shared-tier archival reaches before the `--confirm-shared` gate, whether the run is refused or confirmed.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:35
- provenance: ae2c70a 2026-08-22 read the skill against the CLI; 5ac33f5 2026-08-25 kept the refused path informative.
- verdict: retire
- landed: d2c43f1 section 22
- reason: memq.js prints the reach before the gate on both paths, so a session reads it when it arrives; the sentence describes the output.
- proposed: Drop the "How far the retirement reaches is printed before the gate" sentence from the decay-prune row.

### c1.C124
- key: Expect `get` to print a notice when a memory hit's body is truncated at the 65536-character cap.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: ae2c70a 2026-08-22, which reconciled the cap's account with the shipped CLI.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The notice is printed where the cap binds, and the never-copy rule (c1.C095) already carries the cap as its reason, so nothing a session acts on is lost.
- proposed: Drop "with a notice where the cap binds" from line 38.

### c1.C125
- key: Expect a refused entry echoed in a refusal message to be quoted, capped, and stripped of whitespace and invisible characters so it cannot forge or escape memq's status-line prefix.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: 0d1e610 2026-08-30, the recognition plan, whose refusal messages echo caller-supplied entries.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reduction is memq.js's own defence of its status-line prefix, performed on every refusal and acted on by no session; it is rationale for why column zero can be trusted.
- proposed: Drop the refusal-echo reduction sentence from line 38.

### c2.C001
- key: Run `memq recall` with no search term; it emits the whole store as a bounded digest, one summary line per record, ordered by last sign of life, announcing every truncation with a counted remainder.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:42
- provenance: f270e9c 2026-07-31, the original Memory System commit that shipped the skill and the recall digest together.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rank-it-yourself rule beside it (c2.C002) is obeyable only by a reader who knows the digest is whole-store, ordered by last sign of life and truncation-announcing; the verb prints those lines but ranks nothing (A001 to A003). Flipped from keep to rewrite at section 22's close: c2.C002's rewrite moved the design defence to the ledger, its second sentence standing word for word, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: `memq recall` takes no search term.
- passage: `memq recall` takes no search term. It emits the whole store as a bounded digest, one summary line per record, ordered by last sign of life, and it announces every truncation with a counted remainder.

### c2.C002
- key: Do the ranking yourself, reading the recall digest with the current task in context.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:42
- provenance: f270e9c 2026-07-31, shipped with the digest as the reading rule that makes it useful.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule itself stands and no machinery ranks for the reader; what changes is the wording around it, the design defence and the silent-miss reason moving to this ledger (A004). Keep the instruction to rank against the current task when the sentence is recompressed. Its landing respelled c2.C001's keep sentence; c2.C001 records the flip.
- proposed: State the digest's shape and the rank-it-yourself rule in two sentences; move the design defence and the silent-miss reason to this ledger.
- baseline-test: yes
- passage: You do the ranking, reading the digest with the current task in context.

### c2.C003
- key: Rank the digest yourself because you are the only scorer that knows what you are about to do and a substring miss is silent.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:42
- provenance: f270e9c 2026-07-31, shipped with the digest as the argument for c2.C002.
- verdict: retire
- landed: d2c43f1 section 22
- reason: c2.C002 is stated in the sentence before and is obeyed without the comparison to substring matching, so the reason lives here: the session is the only scorer holding the current task, and a lexical miss produces silence rather than a signal (A005).
- proposed: Delete the "only scorer / substring match / lexical miss is silent" sentence from line 42; its why lives in this ledger under C003.
- baseline-test: yes

### c2.C004
- key: Do not reach for `find` first at effort start; read `recall` first.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:44
- provenance: f270e9c 2026-07-31, the original skill; the paragraph's takeover half arrived later with 5b7dba3 2026-09-02.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands, since nothing makes a session read recall before find; only the surrounding narrowing-versus-surfacing contrast (c2.C005) leaves (A006).
- proposed: Two sentences: read recall before find at effort start; read it again at a seat takeover, at the role skill's fourth step, which owns what that read covers.
- baseline-test: yes
- passage: So read `recall` before `find` at effort start.

### c2.C005
- key: Use `find` to narrow and `recall` to surface the record you would never have thought to search for.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:44
- provenance: f270e9c 2026-07-31, shipped as the contrast explaining c2.C004.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The read-recall-first rule is complete without it and no act turns on the contrast; its content is here, that find narrows a space you already suspect while recall surfaces the record you would not have queried for (A007).
- proposed: Delete the "find is the narrowing tool" sentence from line 44; the why lives in this ledger under C005.
- baseline-test: yes

### c2.C006
- key: Read the recall digest at a seat takeover as well, at the takeover ritual's fourth step.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:44
- provenance: 5b7dba3 2026-09-02, the recognition-reach plan that made a seat takeover read the store before it announces, after a seat re-derived a ruling the store already held.
- verdict: keep
- reason: The installing commit deleted every restatement from the role skill and left a pointer there, making memory-system the owner of this rule; the role skill still points here for what the read covers (A008, A009).
- passage: A seat takeover reads the digest as well, at the takeover ritual's fourth step in the role skill, which owns what that read covers.
- flag: stale

### c2.C007
- key: Read the role skill for what the seat-takeover digest read covers.
- class: pointer
- source: plugins/grimoire/skills/memory-system/SKILL.md:44
- provenance: 5b7dba3 2026-09-02, installed with c2.C006 as the half of the takeover read the role skill owns.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No finding group named it, but the takeover sentence it rides in is recompressed under A006, which folds the pointer into that one sentence; the pointer must survive the fold, since the role skill owns what the takeover read covers.
- passage: at the takeover ritual's fourth step in the role skill, which owns what that read covers.

### c2.C008
- key: Expect `find` to span the machine: its semantic block ranks all three tiers, live and archived, across every project store on the box.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 6cbb24a 2026-08-03, the commit that stated the synced semantic store and its cross-store reach.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: A session weighs a cross-store hit differently from a local one, so the scope changes how output is read and no code tells the reader it is machine-wide (A010). Flipped from keep to rewrite at section 22's close: c2.C009's retire dropped the pending-tier clause after the semicolon, so the sentence was respelled to stand as landed. Landed as the proposal below. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: Where the embedder is installed, it answers by meaning as well as by substring, and its semantic block ranks all three tiers, live and archived, across every project store on the machine rather than this project's tiers alone.
- passage: Where an embedding endpoint is configured, `find` also ranks by meaning in the database, over this project and the shared tiers, live and archived.

### c2.C009
- key: Expect a run's pending tier to be absent from the search index, so a run's unadjudicated writes never reach another session's search.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 6cbb24a 2026-08-03; the exclusion itself is the index builder's walk at plugins/grimoire/scripts/memory-index.js:432.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 8, the paragraph that defines the pending tier, already states the exclusion with its consequence, and the index builder performs it with no session act turning on it (A011 to A013). Deleting the line-46 clause loses nothing the tier's own definition does not carry. Its landing respelled c2.C008's keep sentence; c2.C008 records the flip.
- proposed: (via A011) Delete the pending-tier clause from line 46; line 8 carries it.

### c2.C010
- key: Rerun `find` with `--archived` to display archived records, which are ranked but hidden by default.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 4fe812b 2026-08-03, the commit that withheld archived hits from the semantic block by default.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rerun is the caller's act and the default is invisible from the output; this section is where the withholding is explained, the command table row being the reference entry (A014 to A016). Flipped from keep to rewrite at section 22's close: c2.C126's retire dropped the because clause, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Archived records are ranked but not shown by default.
- passage: A column-zero line counts and scores the archived hits it withheld, so you can judge whether a `--archived` rerun is worth running.

### c2.C011
- key: Read the column-zero suppression line, which counts what was withheld and scores the best of it, to judge whether an `--archived` rerun is worth running.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 4fe812b 2026-08-03, installed with the default so a caller could tell a worthwhile rerun from a wasted one.
- verdict: keep
- reason: The line's two quantities exist exactly for this judgment, which the verb prints evidence for and never makes (A017 to A019).
- passage: A column-zero line counts and scores the archived hits it withheld, so you can judge whether a `--archived` rerun is worth running.

### c2.C012
- key: Read a hit line as name, similarity, tier, store, and where applied two tokens, `applied x4, last 25h`: distinct applied days and age of the most recent.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 1f4934e 2026-08-04, the stamp-adjudication commit that put applied evidence on the hit line.
- verdict: keep
- reason: The freshness-and-weight judgment (c2.C013) rests on knowing which token is a tally and which an age; the verb prints both and judges neither (A020).
- passage: In a hit's `applied x4, last 25h`, judge weight from the distinct-day count and freshness from the age, since the ranking does not.

### c2.C013
- key: Judge a record's freshness from the age token and its weight from the applied count, since the ranking does not do that for you.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 1f4934e 2026-08-04, installed with the two-token display.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule survives; only its tiebreak clause leaves, an internal of the ranker no act turns on, namely that the count shown is the true one rather than the capped value the tiebreak uses (A021).
- proposed: Restructure line 46 so the three rules are stated bare, with the mechanics a reader acts on kept beside them and the retired internals and rationale moved to this ledger.
- baseline-test: yes
- passage: In a hit's `applied x4, last 25h`, judge weight from the distinct-day count and freshness from the age, since the ranking does not.

### c2.C014
- key: Read `superseded by <name>` on the lexical line and a bare `superseded` token on the semantic hit as the same fact; successors are named on the lexical channel only, enumerated name-ordered and capped with a counted remainder.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: b5c0a98 2026-08-23, the memory-supersedes effort, with the naming disclosures added in its finishing pass 0d02214 2026-08-23.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Two facts are acted on and survive: both channels carry the label, and the successor's name rides the lexical line only. The name-ordering, the cap with its counted remainder and the flag-not-sum clause are the verb's own rendering and live here instead (A022 to A024).
- proposed: Compress to one sentence: labeled on both channels, successor named on the lexical line only; move the enumeration and cap detail to this ledger.
- baseline-test: yes
- passage: A superseded record reads `superseded by <name>` on the lexical line and `superseded` on the semantic hit.
- flag: stale

### c2.C015
- key: Expect no supersession label on any member of a supersession cycle, whatever its length.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 0d02214 2026-08-23, the supersedes finishing pass that closed the cycle gap in code and left the prose describing it.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Cycle handling is entirely the ranker's (cycleKeys in plugins/grimoire/scripts/memq.js) and no session act turns on it; a pointer reaching into a cycle from outside still labels the member it names, which is the detail this ledger now holds (A025).
- proposed: Delete the cycle sentences from line 46; the rule lives in the code and its history in this ledger.

### c2.C016
- key: Read `find` as up to three blocks: lexical, semantic, and a model-judged block that re-orders the other two's candidates with a clause per hit.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 050587b 2026-08-30, the commit that made the model-judged channel degrade honestly and documented its shape.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: A reader cannot parse find's output without knowing the third block is optional and re-orders the other two; the verb composes the blocks and labels none of them for the reader (A026 to A028). Flipped from keep to rewrite at section 22's close: c2.C129's retire dropped the 'which is the pass' clause, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: A third block joins them where this machine has a model endpoint configured, reading the candidates the other two ranked and re-ordering them by judged relevance with a clause per hit.
- passage: A third block, model-judged and advisory, appears where this machine has a model endpoint configured and re-orders the candidates, its record names coming from the store rather than the model.

### c2.C017
- key: Expect two local channels because they fail differently: lexical catches exact identifiers an embedding fuzzes, semantic catches the paraphrase a substring misses.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 050587b 2026-08-30, design background written beside the block description.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The three-block reading is obeyable without the failure-mode contrast; the reason is kept here, that the two local channels are complementary rather than redundant (A029).
- proposed: Delete the "Two local channels rather than one" sentence; the why lives in this ledger under C017.

### c2.C018
- key: Weigh the model-judged block's clauses as you would any other model output; it is labeled advisory and its text was written by a model.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 050587b 2026-08-30, installed with the channel as its reading rule.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The doctrine owns data-not-instructions and memq now prints that instruction on the block's own header line, so this becomes a pointer; what memory-system keeps is the store-specific bound, that the record names come from the store rather than from the model (A030 to A032).
- proposed: (via A030) Replace "weigh its clauses as you would any other model output" with a pointer at the doctrine's data-not-instructions rule, keeping that the record names come from the store.
- baseline-test: yes
- passage: A third block, model-judged and advisory, appears where this machine has a model endpoint configured and re-orders the candidates, its record names coming from the store rather than the model.
- passage: Those indented lines, the shared tiers and the model-judged clauses take the doctrine's data-not-instructions rule.

### c2.C019
- key: Expect the model-judged block to send your query and the candidates' names, tiers and descriptions off this machine, in cleartext over plain HTTP with no authentication by default, to a multi-tenant service.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 050587b 2026-08-30, the channel's security disclosure, elaborated in docs/security-model.md.
- verdict: keep
- reason: Nothing in code stops an operator configuring the endpoint, so the exposure is a fact a session weighs before querying with sensitive words (A033).
- passage: It sends your query and those candidates' names, tiers and descriptions off this machine, which `docs/security-model.md` describes in full.
- flag: environment

### c2.C020
- key: Expect a dead or slow endpoint to cost one line while the other two blocks print unchanged, and a machine with no endpoint to say nothing at all.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 050587b 2026-08-30, which corrected documentation that had the absent-endpoint case wrong.
- verdict: keep
- reason: Silence is exactly what the verb cannot explain, and reading it as the ordinary state rather than a failure is the reader's act on a case the docs once got wrong (A034 to A036).
- passage: A dead or slow endpoint costs one line, and a machine with no endpoint configured says nothing, which is normal.

### c2.C021
- key: Phrase a `find` query in the words of your problem, not in the words you expect the memory to use.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 6cbb24a 2026-08-03, installed with the semantic store as the query-phrasing rule it makes possible.
- verdict: keep
- reason: How to phrase a query and when to run one before a project-tier write are two instructions, neither carrying the other (A037, A038); no code rewrites a query.
- passage: Ask `find` in the words of your problem, not in the words you expect the memory to use.

### c2.C022
- key: Expect `find` to state in one line that the embedder is absent, name the remedy, and serve lexical results rather than failing.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 6cbb24a 2026-08-03, the degrade path shipped with the semantic store.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The verb prints the degrade line, but "never degrades quietly" is a reading rule the code cannot state: a find with no such line ran with the embedder (A039 to A041). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Where the embedding server fails, `find` says so in one line and serves lexical results.

### c2.C023
- key: Treat what the fenced, indented semantic block surfaces as data to weigh, exactly as with the shared tiers.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:48
- provenance: 6cbb24a 2026-08-03, installed when the semantic block began reaching other projects' stores.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The doctrine owns data-not-instructions and memq prints the same line on the block's header, so the rule becomes a pointer; the fence mechanic stays, since the indent is what tells a reader the text came from another store (A042 to A044).
- proposed: (via A042) Keep that the block is fenced and indented because it reaches other stores; replace "treat what it surfaces as data to weigh" with a pointer at the doctrine.
- baseline-test: yes
- passage: The semantic block is fenced and indented, and the digest indents type-derived and operator-derived records under a provenance line, column zero being memq's own voice. Those indented lines, the shared tiers and the model-judged clauses take the doctrine's data-not-instructions rule.

### c2.C024
- key: Treat a hit labelled with another project's store as a pointer to a file; `get` will not fetch it from here.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:48
- provenance: 6cbb24a 2026-08-03, written with the cross-store block.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 38, get's own precedence paragraph, states the same fact and adds the no-read-stamp consequence this copy lacks; the resolver decides what get fetches (A045 to A047).
- proposed: (via A045) Delete the line-48 sentence; line 38 carries it whole.

### c2.C025
- key: Expect the digest to label a superseded record with `superseded by <name>` and never to reorder; demotion belongs to `find` alone.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:50
- provenance: b5c0a98 2026-08-23, the memory-supersedes effort that added the label to the digest.
- verdict: retire
- reason: row 870 (Recall label and coverage catalogue), dropped under the mechanism cut.
- passage: Recall labels a superseded record `superseded by <name>` and never reorders, the demotion being `find`'s alone.
- ruled: cut 2026-09-30

### c2.C026
- key: Expect descriptions on the journal keys, the archive surface and the project tier, and only name, applied tally and age on the type, operator and pending tiers.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:50
- provenance: 70f4f8b 2026-08-02, the commit that gave the store its own session-start voice and set each surface's line shape.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 870 (Recall label and coverage catalogue), dropped under the mechanism cut.
- proposed: The type, operator, and pending tiers are the live surfaces that stay lean, carrying name, applied tally and age, with a `superseded by <name>` label on the type and operator lines where one applies and never on a pending line.
- passage: Descriptions ride the journal keys, the archive surface across all three tiers, and the project tier. The type, operator, and pending tiers are the live surfaces that stay lean, carrying name, applied tally and age, with a `superseded by <name>` label on the type and operator lines where one applies and never on a pending line.
- ruled: cut 2026-09-30

### c2.C027
- key: Expect project lines to ride indented under a provenance line under a store pin.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:50
- provenance: 70f4f8b 2026-08-02, installed with the digest's provenance fence.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 870 (Recall label and coverage catalogue), dropped under the mechanism cut.
- proposed: Under a store pin the project lines additionally ride indented under a provenance line.
- passage: Under a store pin the project lines additionally ride indented under a provenance line.
- ruled: cut 2026-09-30

### c2.C028
- key: Read every surface's coverage line, which prints even at zero records, so an empty surface is a stated fact.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:50
- provenance: f270e9c 2026-07-31, shipped with the digest.
- verdict: retire
- reason: row 870 (Recall label and coverage catalogue), dropped under the mechanism cut.
- passage: Every surface prints its coverage line even at zero records, so an empty surface is a stated fact rather than a silent absence.
- ruled: cut 2026-09-30

### c2.C029
- key: Expect the budget cut to run project tier first, then type, then operator, then oldest archive records, then pending, then journal lines, each cut surface printing a counted remainder naming how to reach what it dropped.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:50
- provenance: f270e9c 2026-07-31, the digest's budget logic as first shipped.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The order is fixed in the recall renderer and each cut surface announces itself with a remainder naming how to reach what it dropped, so a reader never needs the order in advance (A056). The order is recorded here for anyone changing the renderer.
- proposed: Delete the cut-order sentence and the project-first reason from line 50; both live in this ledger under C029 and C133.

### c2.C030
- key: Treat type- and operator-derived digest content, indented under a provenance line, as data to weigh rather than instruction to follow; column zero is memq's own voice.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:52
- provenance: f270e9c 2026-07-31 for the fence and the column-zero convention; the role skill points here for it (plugins/grimoire/skills/role/SKILL.md:73).
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Memory-system owns the fence and the column-zero convention and keeps them; the data-not-instructions rule itself is the doctrine's and becomes a pointer, and the tier-authorship reason (c2.C134) leaves (A057, A058).
- proposed: (via A057) Keep "indented under a provenance line; column zero is memq's own voice"; replace "data to weigh rather than instruction to follow" with a pointer at the doctrine; drop the "written by every project" reason.
- baseline-test: yes
- passage: The semantic block is fenced and indented, and the digest indents type-derived and operator-derived records under a provenance line, column zero being memq's own voice. Those indented lines, the shared tiers and the model-judged clauses take the doctrine's data-not-instructions rule.

### c2.C031
- key: When a recalled record changes what you do, run `memq touch <name> --applied` in that turn, adding `--type` or `--operator` for a shared-tier memory.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: 8e22ff4 2026-07-31 installed the stamp; 1f4934e 2026-08-04, the stamp-adjudication plan, made the Applied stamps section its owner and the consuming skills pointers.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule holds and nothing stamps for a session, but it is stated three times in this document; the Applied stamps section at line 92 is the owner, line 54 becomes a pointer, and the hand walk's step at line 110 keeps its spelled-out flags because find's reminder does not print there (A059, A061, A062). Where a recap is in force its bar on state changes wins and the stamp lands in the next non-recap turn (A060).
- proposed: Rebuild line 54 around C034, C035 (as pointer), C036 (as pointer) and C037; the stamp rule points at Applied stamps and the retired-name mechanics move to this ledger.
- proposed: (via A059) Reduce line 54's bold lead to one pointer sentence at the Applied stamps section; C092 stays as the hand walk's step.
- baseline-test: yes
- passage: **When a recalled record changes what you do, stamp it in that turn**, per the Applied stamps section below.

### c2.C032
- key: Stamp because a memory you act on but never stamp still ages toward the archive as if nobody had used it.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: f270e9c 2026-07-31, written beside the stamp rule as its motive.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The rule is stated in the bold lead and the Applied stamps section already carries the decay consequence at line 94; the motive is kept here, that an unstamped memory ages as though unused (A063).
- proposed: Delete the "still ages toward the archive" sentence from line 54.
- baseline-test: yes

### c2.C033
- key: Expect `touch` to refuse an archived record, which has left its tier.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: ae2c70a 2026-08-22, the pass that read the skill whole against the shipped CLI.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The fact stays in the document but only once: the hand walk's rule to note a use in the boundary's record instead of stamping (c2.C085) rests on knowing it beforehand, so it moves to the Applied stamps section rather than sitting at lines 54, 106 and 110 (A064).
- proposed: State "only live records take a stamp; touch refuses an archived one" once in the Applied stamps section; delete C038's four sentences and C135's sentence from line 54.
- baseline-test: yes
- passage: Only live memories take a stamp, since `touch` refuses an archived record.

### c2.C034
- key: Reinstate a project-tier memory by hand: put its file back beside the tier's other memories and restore its index line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: f270e9c 2026-07-31, shipped with the project tier's archive path.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: No program reinstates a project-tier record, so this names a hand move a session would otherwise not know it may make (A065). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Reinstate a retired record that still holds by writing its body again with `--replace` on its tier's verb, which takes the archived flag off.

### c2.C035
- key: Never hand-edit under `memory-types/` or `memory-operator/`; the shared tiers have no reinstatement path.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: f270e9c 2026-07-31 for the line-54 aside; the tier-owning statements arrived with 6cbb24a 2026-08-03 and the guard's enforcement with 426bf68 2026-08-26.
- verdict: retire
- landed: f92e99ec section 5
- reason: The bar holds, but it is stated at lines 54, 143, 153 and 302; each tier's authoring paragraph owns its own rule and the guard section owns enforcement, so line 54 keeps only its own point, that a retired shared record has no reinstatement path, and points at those (A066, A067, A069). The pinning section's operator-side edit is a different actor and vector, not a contradiction (A068). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: (via A067) Reduce line 54's bar to "the shared tiers have no reinstatement path; their authoring rule is each tier's section's, and the pin exception is the pinning section's".
- baseline-test: yes
- passage: The shared tiers have no reinstatement path: a retired shared record that still holds is written fresh, and one that was wrong is removed with `delete-type` or `delete-operator`.

### c2.C036
- key: Recall a retired shared memory with `get`; if it still holds, write a fresh record and let the retired one age, and if it was wrong, remove it with `delete-type` or `delete-operator`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: ae2c70a 2026-08-22, the read-whole-against-the-CLI pass; the four-remedies paragraph at line 162 arrived with b5c0a98 2026-08-23.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The four-remedies paragraph owns routing between delete, repair, supersede and archive, and the neighbours commit a3d8fbf 2026-09-06 already made both authoring paragraphs point there; this rung is a partial copy and becomes a pointer (A070, A071). Lands as the two-way sentence with the paragraph named as the routing's owner rather than as the bare pointer: of the four remedies, repair refuses a name only the archive holds, supersede needs a live same-tier target and archive is already done, so the paragraph routes a retired record nowhere, and delete plus the fresh write are the two that apply. The pointer is scoped to a live record's routing, since the paragraph routes a retired one nowhere. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: (via A070) Replace the sentence with a pointer at the four-remedies paragraph for a retired shared record.
- baseline-test: yes
- passage: A shared record that was wrong is removed with `delete-type` or `delete-operator`. The four-remedies paragraph below routes a live record.

### c2.C037
- key: Avoid reusing a retired record's exact name for a fresh record.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: ae2c70a 2026-08-22, written with the retired-name account the same pass added.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No finding group named it, and it stands without the create-over-retired-name branches that retire around it (A072): nothing refuses the reuse, so the caution is the only thing keeping a session from minting a confusing duplicate name. Flipped from keep to rewrite at section 22's close: c2.C038's retire dropped the two-paths account, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Reusing a retired record's exact name for a fresh one is possible and worth avoiding.
- passage: Avoid reusing a retired record's exact name.

### c2.C038
- key: Expect a create over a retired name to proceed with a stderr note naming the inherited stamps and the delete that removes the retired copy, and any `--update` to refuse while the retired copy is the only one at that name.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: 752dbce 2026-08-22, the shared-tier repair-and-delete section, disclosed in the whole-file pass ae2c70a 2026-08-22.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Every branch is a refusal or a stderr note the add verbs emit, each naming its own remedy, and c2.C037 stands without them (A072). The branches are recorded here: a create proceeds with a note, `--update` refuses while only the retired copy holds the name, and under engine store signals both delete verbs are refused. Its landing respelled c2.C037's keep sentence; c2.C037 records the flip.
- proposed: Delete the four sentences from "A create proceeds" to "carrying a body at all"; the mechanics live in this ledger under C038.

### c2.C039
- key: Read `memq recent` for what happened to the store lately; it groups by write surface, states every group's count even at zero, and dates archived files by the rename rather than the mtime.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:58
- provenance: 31240d3 2026-08-01, the session-recap section that wired `recent` into close-out.
- verdict: keep
- reason: The verb groups and dates; reading the grouping as provenance (c2.C137) is the caller's act, and the close-out reports the digest by surface on that basis (A073 to A075).
- passage: `memq recent` reports what the store recorded lately, grouped by write surface, and each group states its count even at zero.

### c2.C040
- key: Do not read the file group's `added` label as "this memory is new"; an edit to an old memory reports `added` too.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:60
- provenance: c46cd9e 2026-08-01, written after a live close-out disproved the added-versus-updated split.
- verdict: retire
- landed: f92e99ec section 5
- reason: The rule and its consequence stand, since the label still misreports and nothing corrects it; only the rewrite-not-patch mechanism behind it (c2.C139) leaves (A076). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: Two sentences: do not read added as new, since an edit reports added too; read the names against what the effort wrote when the recap must say which are new.
- baseline-test: yes
- passage: Do not read the file group's `added` label as new, since an edit to an old memory reports `added` too.

### c2.C041
- key: To say which records are genuinely new, read the names against what the effort actually wrote rather than trusting the label.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:60
- provenance: c46cd9e 2026-08-01, installed with c2.C040 as the remedy for the mislabelled group.
- verdict: retire
- landed: f92e99ec section 5
- reason: No finding group named it and it survives A076's recompression as the second of two sentences; the recap still has to name new records and only the session's own account of what it wrote can do that. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: To say which records are new, check the names against what the effort wrote.
- flag: weak-reason

### c2.C042
- key: Run `memq recent` over the session's span at close-out and carry the digest into the close-out status, labeled by surface.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:62
- provenance: 31240d3 2026-08-01, the recap section that wired the run into close-out.
- verdict: retire
- superseded-by: S001
- reason: The section states the trigger with the carry-into-status obligation the command table row only summarises; nothing runs `recent` for a closing session (A077, A078). Superseded at `4b2e64c` by S001 (the Section 8 merge; the verdict before it was keep).

### c2.C043
- key: Take the close-out recap trigger from `finishing-work` step 7, which also owns the decay pass.
- class: pointer
- source: plugins/grimoire/skills/memory-system/SKILL.md:62
- provenance: 31240d3 2026-08-01, placed on the precedent the decay pointer had already set.
- verdict: retire
- superseded-by: S004
- reason: Two pointers at one owner are not two owners, and deleting this one would leave the recap section naming no trigger owner (A079, A080). Superseded at `4b2e64c` by S004 (the Section 8 merge; the verdict before it was keep).

### c2.C044
- key: Verify the store sync at close-out rather than driving it; the store syncs itself.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:64
- provenance: 945a75c 2026-08-19, which aligned the skill to the self-syncing store, closed out in bbd6545 2026-08-19.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands, but the four-state nag enumeration beside it retires: the hook prints each state's own line and the enumeration has already drifted once, corrected in the worktree-store finishing pass (A082). Keep one sentence naming the runner and its allowlist-gated commit and push. Lands as the rule plus the one runner sentence; the consequence sentence ('So a session's writes reach the private remote at the next session start with nothing to hand-run') left with the nag list as un-keyed text of the same passage. The four nag states the proposal moves here have their home in the hook's own state table in plugins/grimoire/hooks/memory-session.js rather than in this ledger.
- proposed: Keep the rule and one sentence naming the runner and its allowlist-gated commit and push; move the nag-state list to this ledger.
- baseline-test: yes
- passage: The store then syncs itself, and the close-out verifies that rather than driving it.

### c2.C045
- key: Expect the Windows SessionStart hook to run `doctor/sync-store.ps1`, committing new and edited memory files through the allowlist gate and, where an upstream exists, fetching, screening, rebasing and pushing, and to nag only when the sync stood down.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:64
- provenance: 945a75c 2026-08-19, the self-syncing store's own documentation.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The verify-rather-than-drive rule needs the reader to know what does the driving, so one sentence stays; the state-by-state nag enumeration is superseded by the hook's own lines in plugins/grimoire/hooks/memory-session.js (A082). The four nag states the proposal moves here have their home in the hook's own state table in plugins/grimoire/hooks/memory-session.js rather than in this ledger.
- proposed: Keep the rule and one sentence naming the runner and its allowlist-gated commit and push; move the nag-state list to this ledger.
- baseline-test: yes
- passage: On Windows the SessionStart hook spawns `doctor/sync-store.ps1`, which commits through the allowlist gate and, where an upstream exists, screens incoming content, rebases and pushes.
- flag: stale

### c2.C046
- key: Use the kit doctor's `-Fix` to repair or initialize the store, clear a standing gate, and commit this session's writes immediately; it commits and never pushes.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: 945a75c 2026-08-19 for the doctor path; the commits-never-pushes clause is 2bdc43b 2026-08-31, a standing-lines fix so the skill stops promising a push the fix pass does not make.
- verdict: keep
- reason: Running `-Fix` is the session's act and the doctor repairs only once run; the never-pushes half is exactly the promise that was found wrong once already (A083 to A085).
- passage: The kit doctor's `-Fix` sets the store up, clears a standing gate and commits this session's writes, but never pushes.

### c2.C047
- key: Off Windows, run the sync by hand as that commit plus the manual push, since there is no PowerShell runner.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: 2bdc43b 2026-08-31, stated where the hook's Windows-only gate is (plugins/grimoire/hooks/memory-session.js:58).
- verdict: keep
- reason: No runner exists off Windows, so both steps are the session's and no machinery can supersede the instruction (A086).
- passage: The push comes from the runner at the next session start or a hand path below, and off Windows, with no runner, the commit and the push are both hand-run.

### c2.C048
- key: Before running `-Fix` from a tool shell, tell the operator what it would do and get a go-ahead, then pass `-Yes`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: e23b88a 2026-08-03, which closed the gaps between what the store said and what it did, after the close-out sequence was found inert and the consent prompt was made to name what it is about to do.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The gate stays as the kit doctor's own over its run, no longer grounded in the doctrine's stop-for-a-yes bullet, whose closed list now names the store's sync. It carries the store-specific mechanic that a bare `-Fix` declines on a redirected stdin (A087, A089). The rewrite is the surrounding paragraph's restructure, not the rule's (A088).
- proposed: Restructure line 66: the doctor's role in one sentence; the from-a-tool-shell rule; the manual pair with its PASS/FIXED gate; the script as the better hand path with its two disclosures and the security-model pointer; the WARN handling.
- baseline-test: yes
- passage: Running `-Fix` from a tool shell: its consent prompt cannot reach a redirected stdin, so a bare `-Fix` declines. Tell me what it would do, get my go-ahead, then pass `-Yes`.

### c2.C049
- key: Do the manual push as `git -C ~/.claude pull --rebase` then `git -C ~/.claude push`, and only once the memory-sync line reads PASS or FIXED; a FAIL is a stop.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: 16c65f7 2026-08-03, the sync-freshness nudge and close-out sync step; the commit-and-push default that frames it is ebd12d2 2026-09-02.
- verdict: keep
- reason: The passage orders the two hand paths itself, the script preferred where PowerShell exists and this pair the fallback, so no state produces two acts (A091); the gate and its FAIL stop are the session's to read. The passage also restates that the pair needs no go-ahead, and says the consent in the paragraph above is the doctor's own over its `-Fix` run. That is the bound stated at C048 rather than a second rule, restated here because the two sit one paragraph apart and a ruled probe moved to declining the push once the prose pass split the permission two paragraphs back.
- passage: The manual push is `git -C ~/.claude pull --rebase` then `git -C ~/.claude push`. It needs no go-ahead either, since it is the sync and the doctrine's closed list never gates it. Run it only once the doctor's memory-sync line reads PASS or FIXED, since a FAIL there is a stop.

### c2.C050
- key: Prefer hand-running `doctor/sync-store.ps1` with an explicit `-StoreRoot` over the pull-and-push pair.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: ddcb28e 2026-09-08, the store-git-guard plan's close, whose security review installed the preference and its two disclosures.
- verdict: keep
- reason: No finding group named it; the preference holds because the pair takes no lock against the background sync and screens no incoming tree, while the script does both (A091 records the ordering as intentional, not a conflict). The passage states the preference beside that reason rather than as a bare ranking, since a session syncing unasked has to know why one path is better. It names the flag rather than a value: the script has no default store root (plugins/grimoire/doctor/sync-store.ps1:86), so a run that omits `-StoreRoot` is a parameter error rather than a sync against the wrong directory.
- passage: Where PowerShell exists, prefer hand-running `doctor/sync-store.ps1` under the kit plugin root with an explicit `-StoreRoot`, which also takes the sync lock and screens incoming content.
- flag: stale

### c2.C051
- key: Carry a doctor WARN into the close-out rather than treating it as a gate, and treat a FAIL as a stop already delivered.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: kaizen/archive/2026-08-07-memory-sync-destination.md, after a destination WARN was found blocking legitimate pushes; landed in the skill with 945a75c 2026-08-19.
- verdict: keep
- reason: The doctor classifies but does not decide what a session does with a WARN, and the incident that installed the distinction is a live class (A092).
- passage: A memory-sync WARN comes only after every leak probe read clean, so carry it into the close-out rather than treating it as a gate. An unanswerable probe reports as FAIL, a stop already delivered.

### c2.C052
- key: Write action keys dot-namespaced with the project or domain leading, as in `neo.sql.procs` or `neat.deploy.iis`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:70
- provenance: 8e22ff4 2026-07-31, the memory-extension commit that shipped the outcome journal and its key convention.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No program checks a key against the dot-namespaced shape, so the convention is the author's to hold (A093). Flipped from keep to rewrite at section 22's close: c2.C053's rewrite thinned the specimen keys from three to one, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Dot-namespaced, project or domain leading: `neo.sql.procs`.
- passage: Dot-namespaced, project or domain leading: `neo.sql.procs`.

### c2.C053
- key: Lead an action key with the name a future session will reach for and keep one hierarchy per subject rather than minting near-duplicates.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:70
- provenance: 8e22ff4 2026-07-31, installed with the journal's key convention.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands and the substring bound stays as what it rests on, since `find` matches key substrings; only the specimen keys thin from three to one (A094). Its landing respelled c2.C052's keep sentence; c2.C052 records the flip.
- proposed: One specimen key, then the two rules with the substring bound.
- baseline-test: yes
- passage: `find` matches key substrings, so lead with the name a future session will reach for, and keep one hierarchy per subject rather than minting near-duplicates.

### c2.C054
- key: Use tags for a fact that cuts across the hierarchy, not a second key.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:70
- provenance: 8e22ff4 2026-07-31, installed with the key convention and the tag vocabulary together.
- verdict: keep
- reason: No finding group named it and A094 records it as standing; it is the rule that keeps the key hierarchy from growing a second axis nothing queries.
- passage: A fact that cuts across the hierarchy takes a tag, not a second key.

### c2.C055
- key: Log an outcome when a future session, about to act on that key, would stop or steer differently after reading it.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:74
- provenance: 8e22ff4 2026-07-31, the journal's own bar as first shipped.
- verdict: keep
- reason: No finding named it. It is the whole test for what enters the journal, and nothing decides it for a session.
- passage: Log an outcome when a future session, about to act on that key, would stop or steer differently after reading the entry.
- flag: weak-reason

### c2.C056
- key: Log a failure that carries a cause and a countermeasure.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:77
- provenance: 8e22ff4 2026-07-31, one of the three worked instances of the bar at line 74.
- verdict: keep
- reason: No finding named it; it names the commonest entry the journal exists to hold.
- passage: A failure with a cause and a countermeasure: `memq log neo.sql.openquery fail "OPENQUERY truncates NVARCHAR(MAX); stage through a temp table"`.
- flag: weak-reason

### c2.C057
- key: Log a success that settled an open question.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:78
- provenance: 8e22ff4 2026-07-31, shipped with the journal's inclusion list.
- verdict: keep
- reason: No finding named it; without it the journal would collect only failures and lose the settled questions a later session would otherwise reopen.
- passage: A success that settled an open question.
- flag: weak-reason

### c2.C058
- key: Log an outcome that flips what the store currently believes, in either direction.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:79
- provenance: 8e22ff4 2026-07-31, shipped with the journal's inclusion list.
- verdict: keep
- reason: No finding named it; it is the case that keeps a stale belief from surviving the evidence that contradicted it.
- passage: An outcome that flips what the store currently believes, either direction.
- flag: weak-reason

### c2.C059
- key: Skip routine successes such as a green build, a passing suite or a clean commit.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:82
- provenance: 8e22ff4 2026-07-31, the journal's exclusion list.
- verdict: keep
- reason: No finding named it; it is what keeps the journal readable, and nothing filters routine entries out after the fact.
- passage: Routine successes: a green build, a passing suite, a clean commit.
- flag: weak-reason

### c2.C060
- key: Skip a failure explained by your own typo or a transient outage.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:83
- provenance: 8e22ff4 2026-07-31, the journal's exclusion list.
- verdict: keep
- reason: No finding named it; a failure with no durable cause teaches a later session nothing and would dilute the entries that do.
- passage: A failure explained by your own typo or a transient outage.
- flag: weak-reason

### c2.C061
- key: Put a durable fact with no event attached in a memory file rather than a journal entry.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:84
- provenance: 8e22ff4 2026-07-31, the boundary between the journal and the memory tiers as first drawn.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The doctrine routes a learning away from the plan doc; this routes a durable fact away from the journal. Two boundaries, both needed, so neither is a copy of the other (A096). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: A durable fact with no event attached, which belongs in a memory record.

### c2.C062
- key: Write the summary and detail yourself and never paste raw tool output into a memq argument.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:86
- provenance: 8e22ff4 2026-07-31 for the composing rule; the quote hazards behind it were documented in 8f2b500 2026-08-08 and c56a8b5 2026-08-21.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands, since the incident class recurs on every PowerShell 5.1 box and memq only diagnoses after the fact (kaizen/archive/2026-08-16-memq-count-diagnostic.md); what compresses is the five sentences of mechanics after it (A097 to A099).
- proposed: The three rules, then two sentences: a stored body is the one thing unsafe to paste onto a cmd.exe line; PowerShell 5.1 breaks an argument carrying an embedded quote before memq runs and memq prints a hint naming that cause, so quote-free one-line prose is safe on every path.
- baseline-test: yes
- passage: **Write the summary and detail yourself, never paste raw tool output into a memq argument, and compose without embedded `"` characters.**

### c2.C063
- key: Compose memq arguments without embedded `"` characters.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:86
- provenance: 8f2b500 2026-08-08, which stated the input caps and the quote hazards.
- verdict: keep
- reason: No finding group named it and A098 records it as standing in the bold lead; quote-free one-line prose is the only form safe on every shell path.
- passage: **Write the summary and detail yourself, never paste raw tool output into a memq argument, and compose without embedded `"` characters.**

### c2.C064
- key: Name the shape of a secret in a journal entry, never its value, since the journal is plaintext on disk and read back into context.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:86
- provenance: 8e22ff4 2026-07-31 for the bar; restated at its present strength in e23b88a 2026-08-03.
- verdict: keep
- reason: This is the general shape-not-value bar with its worked example, and the triggers sentence at line 233 merely applies it to one field; this side is the owner (A101).
- passage: The journal is plaintext on disk and read back into context, so name a secret's shape ("the connection string was missing Encrypt=True"), never its value.

### c2.C065
- key: Expect memq to strip `"` from a log summary, a log detail and a shared-tier description, but never from a record body, so a body is the one thing the store hands out that is unsafe to paste onto a `cmd.exe` command line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:86
- provenance: 8f2b500 2026-08-08, the charset rule at plugins/grimoire/scripts/memq.js:1964.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The strip is memq's own and a reader never performs it; the one clause worth keeping is the consequence, that a stored body is not charset-reduced and so is unsafe to paste onto a cmd.exe line (A102).
- proposed: (via A098) The three rules, then two sentences: a stored body is the one thing unsafe to paste onto a cmd.exe line; PowerShell 5.1 breaks an argument carrying an embedded quote before memq runs and memq prints a hint naming that cause, so quote-free one-line prose is safe on every path.
- baseline-test: yes
- passage: A stored body is never charset-reduced, so never paste one onto a `cmd.exe` command line.

### c2.C066
- key: Expect Windows PowerShell 5.1 to break a quoted argument carrying an embedded `"` before memq runs, and read memq's hint naming that cause; only a caller inside `cmd.exe` reaches the `%*`-forwarding shim where an odd quote count can run text after a `&` as a command.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:86
- provenance: 8f2b500 2026-08-08 and c56a8b5 2026-08-21; the shim's forwarding is covered in docs/security-model.md.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: memq's hint diagnoses after the fact and prevents nothing, so the reader still needs the cause and the safe-on-every-path clause; the `%*`-forwarding account is a security-model matter and compresses out (A103).
- proposed: (via A098) The three rules, then two sentences: a stored body is the one thing unsafe to paste onto a cmd.exe line; PowerShell 5.1 breaks an argument carrying an embedded quote before memq runs and memq prints a hint naming that cause, so quote-free one-line prose is safe on every path.
- baseline-test: yes
- passage: Windows PowerShell 5.1 breaks an argument carrying an embedded `"` before memq runs, so quote-free one-line prose is the safe form.
- flag: stale

### c2.C067
- key: Use `--body-file` only for a body you composed, never a file you merely have: not a `.env`, a settings or credentials file, or raw log or tool output.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:88
- provenance: c56a8b5 2026-08-21, which gave shared-tier bodies a channel no shell can mangle and bounded what may ride it.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands, since a shared-tier body syncs to a remote every machine and person sharing the kit can read; the normalization and cap mechanics beside it (c2.C069) leave, and the remote's readership becomes this ledger's reason (A104). Its landing respelled c2.C068's keep sentence; c2.C068 records the flip.
- proposed: Two sentences: --body-file is for a body you composed, never a .env, a settings or credentials file, or raw output; read a file you did not write before naming it.
- baseline-test: yes
- passage: **`--body-file` is for a body you composed, never a file you merely have**: not a `.env`, a settings or credentials file, or raw log or tool output.

### c2.C068
- key: Read a file you did not write yourself before naming it to `--body-file`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:88
- provenance: c56a8b5 2026-08-21, installed with the body-file channel.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No finding group named it and A104 keeps it as the second of two sentences; nothing inspects a body-file's contents before it lands on a shared tier. Flipped from keep to rewrite at section 22's close: c2.C067's two-sentence form left the clause opening a sentence, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Read a file you did not write yourself before you name it.
- passage: Read a file you did not write yourself before you name it.

### c2.C069
- key: Expect a `--body-file` text to land normalized to what argv could have carried, and a file whose text plus heading and frontmatter exceeds 65536 characters to be refused whole rather than trimmed.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:88
- provenance: c56a8b5 2026-08-21, the body-file reader's own guarantees.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Both are performed by the body-file path and the refusal names itself, so no act turns on knowing either in advance (A105); the cap is 65536 characters counted over text plus heading and frontmatter, refused whole rather than trimmed.
- proposed: Delete the normalization and cap clauses from line 88; they live in this ledger under C069.

### c2.C070
- key: Treat a memory as applied only when it changed what you did, and run `memq touch <name> --applied` in that turn, adding `--type` or `--operator` for a shared tier.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:92
- provenance: 8e22ff4 2026-07-31 for the definition; 1f4934e 2026-08-04 made this section the owner both consuming skills point at.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The definition stands and is the owner's statement, and it does not fight the stamp-on-doubt bar: this says what application is, c2.C075 sets the evidentiary bar under uncertainty. Only the three worked instances trim to one and the read-stamp mechanic compresses (A107).
- proposed: The definition with one instance, the in-turn stamp with its flags, and one clause that reads are recorded for you.
- baseline-test: yes
- passage: **Applied means acted on, not merely read.** A memory is applied when it changed what you did, as when you followed its warning. In that turn, run `memq touch <name> --applied`, adding `--type` or `--operator` for a shared-tier memory.

### c2.C071
- key: Expect reads to be recorded for you by the read-stamp hook when a tier memory file is opened with the Read tool, and by `memq get` when it serves a body.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:92
- provenance: 8e22ff4 2026-07-31, with the hook at plugins/grimoire/hooks/memory-usage-stamp.js.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The reader needs only that reads are recorded for them and where the hook's scope ends, so that no session stamps reads by hand or expects a MEMORY.md read to count; the tier-children bound the untracked-reader list at line 102 rests on stays (A108 to A110).
- proposed: One clause: reads are recorded for you by the read-stamp hook (tier memory files opened with Read, never MEMORY.md) and by memq get.
- baseline-test: yes
- passage: Reads are recorded for you, on the two paths named below.
- passage: Only two readers leave a read stamp in the tiers `unstamped` sweeps: `memq get` serving a project, type or operator body, and the read-stamp hook on a Read of such a file.

### c2.C072
- key: Expect only `applied` stamps to reset a memory's idle clock, with `read` stamps riding along as evidence for the summarize-versus-archive judgment.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:94
- provenance: 8e22ff4 2026-07-31, shipped with the decay lifecycle.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The decay lifecycle section at line 258 owns the clock's keying with its thresholds, so this site keeps a one-clause pointer plus the consequence a stamper acts on, that a memory read forever and applied never will be flagged (A111 to A113). Lands with 'and `read` stamps never do' beside the applied clause, because c5.C002 retires the decay section's statement on the ground that this section states it.
- proposed: (via A111) Compress line 94 to "only applied stamps move the decay clock, which the decay lifecycle section owns; a memory read forever and applied never will be flagged".
- baseline-test: yes
- passage: Only `applied` stamps move the decay clock, never `read` stamps, so a memory read forever and applied never will be flagged.
- flag: stale

### c2.C073
- key: Run `memq unstamped` to diff reads against applied stamps inside a window and hand back which opened files changed what you did.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:96
- provenance: 1f4934e 2026-08-04, the stamp-adjudication plan that scheduled adjudication while the judgment is still fresh.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The verb builds the list and answers nothing; running it and recognising over its rows are the caller's acts (A114 to A116). Flipped from keep to rewrite at section 22's close: c2.C144's retire dropped the 'survive both' antecedent, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: It diffs reads against applied stamps inside a window and hands back the gap: of the files somebody opened, which one changed what you did.
- passage: It lists the memories opened inside a window and never stamped applied.

### c2.C074
- key: Run `unstamped` at every Chapter boundary and as a final sweep before the decay pass.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:96
- provenance: 1f4934e 2026-08-04; the two triggers are owned by executing-work and by finishing-work step 7 (plugins/grimoire/skills/finishing-work/SKILL.md:94).
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The trigger stands, but the four sentences explaining why the other two instruments under-fire (c2.C144) are exactly the motivating clauses the unstamped effort learned to delete, each having proved false in some state; the repair was to state the trigger bare (A117 to A119). The finishing-work trigger is step 8, whose unstamped sweep sits at plugins/grimoire/skills/finishing-work/SKILL.md:98 at HEAD.
- proposed: Two sentences: unstamped diffs reads against applied stamps in a window and hands back the gap; executing-work runs it at every Chapter boundary and finishing-work as a final sweep before the decay pass.
- baseline-test: yes
- passage: Executing-work runs it at every Chapter boundary, and finishing-work runs a final sweep before the decay pass.
- flag: stale

### c2.C075
- key: When in doubt whether a memory steered you, stamp it; the bar is whether it plausibly steered you, not whether you can prove it.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:98
- provenance: 1f4934e 2026-08-04, installed beside the application definition so both consuming skills could point at one bar.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The bar stands and nothing adjudicates a doubtful stamp for a session; only its cost-asymmetry argument (c2.C076) leaves (A120).
- proposed: Two sentences: the bar is whether it plausibly steered what you did, not whether you can prove it; when in doubt, stamp.
- baseline-test: yes
- passage: **The bar is whether it plausibly steered what you did, not whether you can prove it.** When in doubt, stamp.

### c2.C076
- key: Stamp on doubt because a false applied costs one decay cycle while a missed applied ages a load-bearing memory toward the archive.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:98
- provenance: 1f4934e 2026-08-04, written beside the bar as its argument.
- verdict: retire
- landed: d2c43f1 section 22
- reason: "When in doubt, stamp" is the whole instruction and is obeyed without the comparison (A121); the asymmetry is held here, a false applied costs one decay cycle while a missed one ages a load-bearing memory toward the archive.
- proposed: Delete the two cost sentences from line 98.
- baseline-test: yes

### c2.C077
- key: Expect a memory acted on straight from the `recall` digest's description, its file never opened, to generate no read stamp and never enter the `unstamped` candidate list.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:100
- provenance: 1f4934e 2026-08-04, installed to keep the in-turn habit in force once `unstamped` existed (hook scope at plugins/grimoire/hooks/memory-usage-stamp.js).
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The gap is the hook's scope, but the reader act beside it (c2.C078) rests on knowing the digest path is untracked, so the two merge into two sentences; the design reason, that instrumenting `recall` would stamp reads that are not reads, moves here (A122 to A124).
- proposed: Two sentences: a memory acted on from the digest's description, its file never opened, leaves no read stamp and never enters the list; so unstamped is the backstop and the in-turn habit and find's reminder stay in force.
- baseline-test: yes
- passage: Every other reader leaves none, a description acted on from the `recall` digest among them.

### c2.C078
- key: Keep the in-turn stamping habit and find's closing reminder in force; treat `unstamped` as a backstop, not a replacement.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:100
- provenance: 1f4934e 2026-08-04, installed with the digest-gap disclosure so a new backstop would not retire the habit.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands, since the backstop cannot see the digest path at all; it merges with c2.C077 into two sentences (A125, A126). Two findings routed here were misrouted from the `--machine` field's paragraph and rule nothing on this claim (A125, A127).
- proposed: (via A123) Two sentences: a memory acted on from the digest's description, its file never opened, leaves no read stamp and never enters the list; so unstamped is the backstop and the in-turn habit and find's reminder stay in force.
- baseline-test: yes
- passage: So `unstamped` is the backstop, not the replacement, and the in-turn habit and find's closing reminder stay in force.

### c2.C079
- key: Treat every reader other than `memq get` and the read-stamp hook as untracked and leaving no stamp: a shell reader, a description acted on from a digest or hit, an index line already in context, a Read of `MEMORY.md`, and a `get` a run's pending tier answers.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:102
- provenance: f1e3363 2026-08-25, the consult that drew the boundary an acceptance criterion had left unnamed, after four review rounds each found a new unread surface.
- verdict: keep
- reason: This is the owner of the untracked-reader class; knowing which of your own reads were untracked is a judgment no program makes, and the copies elsewhere (the Known limits bullet, line 145) restate one member each (A128 to A130).
- passage: Every other reader leaves none, a description acted on from the `recall` digest among them.

### c2.C080
- key: Read an `unstamped` zero as containing your own session's absence of evidence, meaning either your reads went untracked or the stretch read nothing, and rest the window on your own account of the stretch.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:104
- provenance: 5e84677 2026-08-25, the interim board on a rule that overclaimed and then underdetermined, closed in f1e3363 2026-08-25.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The reading stands and memory-system is its one owner, the consuming skills carrying pointers; the compression is the effort's own lesson, to state the rule bare (A131 to A133).
- proposed: Read a zero as containing your own absence of evidence and rest the window on your account; treat a count as evidence tracking happens, never proof yours was tracked; read a lost-evidence verdict as a floor and a floor line beside hits as an open question.
- baseline-test: yes
- passage: A zero with no read stamp in the window is an absence of evidence, so the window rests on your own account.

### c2.C081
- key: Treat an `unstamped` count as evidence that tracking is happening in this store, never as proof that what you read was tracked.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:104
- provenance: 04002f6 2026-08-25, the interim board where the rule kept surviving while its reasons kept dying.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No group named it directly, but A132 recompresses the passage it sits in and moves its sidecar-sharing account here: stamps name a file and a time and no writer, and the sidecars are shared across worktrees, projects and machines, so a count proves tracking happens somewhere and never that yours was tracked.
- passage: A count shows tracking happens in this store, never that your own reads were tracked.

### c2.C082
- key: Read a verdict naming lost usage evidence as a floor and a warning that a hidden record may await a stamp, not as a clean sweep, and treat a floor line beside hits as an unresolved question.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:104
- provenance: f1e3363 2026-08-25, with the torn-line repair in ad7b109 2026-08-25 that stopped two scans calling a gap an absence.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: memq prints the verdict text and the floor lines, so what stays is the reading act: a floor is a floor, and a floor line beside hits is an open question. The account of which loss shape triggers which wording is the command's own and leaves (A134 to A136).
- proposed: (via A132) Read a zero as containing your own absence of evidence and rest the window on your account; treat a count as evidence tracking happens, never proof yours was tracked; read a lost-evidence verdict as a floor and a floor line beside hits as an open question.
- baseline-test: yes
- passage: Where the verdict names lost evidence, the count is a floor, and a floor line beside hits is an open question.

### c2.C083
- key: Treat no report as a swept window on its own; set the report against your own account of the stretch.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:106
- provenance: 04002f6 2026-08-25, the board that settled the two-instruments rule.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands, since the report has blind spots no reader can see from it; only the enumeration of those blind spots (c2.C145) leaves, its content moving here (A137 to A139).
- proposed: State the two-instruments rule, the walk-adjudicate-stamp procedure with its discharge condition, and the note-in-record rule; move the blind-spot list to this ledger.
- baseline-test: yes
- passage: No report is a swept window on its own. Set it against your own account of the stretch: adjudicate every listed line, then stamp by name any use the list did not raise.

### c2.C084
- key: Walk the report's list, adjudicate every line on it, then set your account against it and stamp by name any use the list did not raise.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:106
- provenance: 04002f6 2026-08-25, installed with the two-instruments rule as its procedure.
- verdict: keep
- reason: The section owns the act together with its discharge condition, that a stretch whose every use is adjudicated or stamped by name discharges the boundary whatever the report said about coverage (A140, A141).
- passage: Set it against your own account of the stretch: adjudicate every listed line, then stamp by name any use the list did not raise.
- passage: A stretch whose every use is adjudicated or stamped by name discharges the boundary.

### c2.C085
- key: Note a use in the boundary's own record rather than stamping it where the record has left its tier.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:106
- provenance: 04002f6 2026-08-25, written with the walk once `touch`'s archived refusal was known.
- verdict: keep
- reason: No finding group named it and A138 keeps it as one of three rules; it rests on the archived-refusal fact, which moves to the Applied stamps section under A064 rather than being restated here.
- passage: A use whose record has left its tier is noted in the boundary's own record instead.

### c2.C086
- key: Do the hand walk when you cannot produce an account of the stretch, settled by trying to enumerate and coming up short rather than by recognising a cause.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:108
- provenance: 04002f6 2026-08-25, the board round that replaced an event-based trigger with the try-and-fail test.
- verdict: keep
- reason: No finding named it. The trigger is deliberately a test rather than an event, since no event decides it in advance and a compaction inside the stretch decides it least of all; nothing can make that call for a session.
- passage: A boundary owes the hand walk when it tries to enumerate the stretch's uses and comes up short, never because of an event.
- flag: weak-reason

### c2.C087
- key: Enumerate the hand walk from the store rather than from memory: read `recall`'s digest and work its live rows.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:110
- provenance: a0edaed 2026-08-25, the round that held the rule and killed its reasons.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The five walk rules stand and compress to bare sentences, c2.C087 keeping the digest's bound that it carries archived records and `touch` refuses a name that has left its tier; the get-stamps-a-read reason leaves (A142).
- proposed: Five bare sentences in the readers' compressed shape, with the digest's archived-and-refused bound on C087 kept.
- baseline-test: yes
- passage: The walk works the live rows of `recall`'s digest.

### c2.C088
- key: Read the type and operator indexes directly for their descriptions, and read any tier's index directly where the digest says its budget bound.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:110
- provenance: a0edaed 2026-08-25, installed with the hand walk.
- verdict: rewrite
- landed: 227ba108 section 5
- reason: No group named it directly; it is one of the five rules A142 keeps and recompresses. It holds because the digest describes the project tier's records and merely names the shared tiers', so a walk that stopped at the digest would decide those tiers blind. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- passage: It reads a record's description from the digest where its line carries one, and from `memq find` in the record's name where it does not or where the digest says its budget cut.

### c2.C089
- key: Decide from a description wherever one can decide, and spend `memq get` only where none can.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:110
- provenance: a0edaed 2026-08-25, installed with the hand walk.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: One of A142's five rules, kept and recompressed. It holds because `get` stamps a read on every body it serves, so a walk that opens everything writes use into the store the session never had.
- passage: Decide from a description where one can, and spend `memq get` only where none can.

### c2.C090
- key: Spare `get` because it stamps a read on every body it serves, so a walk that opens everything writes use into the store the session never had.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:110
- provenance: a0edaed 2026-08-25, written beside c2.C089 as its motive.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The rule to spend `get` only where a description cannot decide is stated before the clause and is obeyed without it (A143); the motive lives here and under c2.C089.
- proposed: Delete the "because get stamps a read" clause from line 110.
- baseline-test: yes

### c2.C091
- key: Name in the boundary's own record the records the walk opened, so the next boundary meets those reads with the walk's account on them.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:110
- provenance: a0edaed 2026-08-25, installed with the hand walk.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: One of A142's five rules, kept and recompressed. It holds because a body opened during a walk is indistinguishable at the next boundary from a body the work actually used.
- passage: Name in the boundary's own record the records the walk opened.

### c2.C092
- key: Then run `touch --applied` for what steered the work, carrying `--type` or `--operator` for a shared-tier record.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:110
- provenance: a0edaed 2026-08-25, the walk's closing step.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: One of A142's five rules, kept and recompressed; the flags are spelled out here rather than pointed at because find's reminder line prints only where the report raised a hit, which is why A059 leaves this step whole while line 54 becomes a pointer.
- passage: Then `touch --applied` what steered the work, with `--type` or `--operator` for a shared-tier record.

### c2.C093
- key: Expect a Write into a project's memory directory to be rewritten into the harness's frontmatter shape in the same second, moving your top-level keys into a column-0 `metadata:` map and adding harness keys beside them.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:114
- provenance: eecf17c 2026-08-24, after the harness rewrite was found silently relocating fields; recorded as the operator-tier memory claude-code-rewrites-memory-frontmatter-into-metadata.
- verdict: retire
- landed: f92e99ec section 5
- reason: The rewrite is the harness's, but c2.C094 and c2.C095 are obeyable only by a reader who knows their keys move under `metadata:`, so one sentence stays; the enumeration of the harness's own keys and the name/description variants (c2.C147) leaves, since memq keys on the map's shape and never on a marker key (A144). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: One sentence: on Claude Code a Write into a project's memory directory is rewritten in the same second, your top-level keys moving under a column-0 metadata: map beside keys of the harness's own.
- baseline-test: yes
- passage: On Claude Code a Write into a project's memory directory is rewritten in the same second, your top-level keys moving under a column-0 `metadata:` map beside keys of the harness's own.

### c2.C094
- key: Do not read any one key as the marker of the rewritten shape, and do not read the rewrite as your write failing.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:114
- provenance: eecf17c 2026-08-24, installed with the rewrite disclosure.
- verdict: retire
- landed: f92e99ec section 5
- reason: The rule stands, since which keys ride along varies by harness version and by which memory feature wrote the record; only the passage around it compresses (A145). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: (via A144) One sentence: on Claude Code a Write into a project's memory directory is rewritten in the same second, your top-level keys moving under a column-0 metadata: map beside keys of the harness's own.
- baseline-test: yes
- passage: Which keys ride along varies by harness version, so no one key marks the shape, and the rewrite is not your write failing.

### c2.C095
- key: Write every frontmatter field at the top level and expect to find it under `metadata:` afterwards.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:116
- provenance: eecf17c 2026-08-24, installed as the one statement of where a hand-written field lands.
- verdict: retire
- landed: f92e99ec section 5
- reason: This is the owner of the placement rule and every field's own paragraph restating "top level, read there or under metadata:" is the copy; the rule keeps its bound, that both placements are read with the top-level value winning and a field under any other key is read at neither, while the seven-field list and the keying strategy leave (A146 to A148). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: The rule, then one sentence: memq reads its fields at both placements, top-level winning, and a field under any other key or nested deeper is read at neither; memq's own writes and the archive move preserve shape.
- baseline-test: yes
- passage: **So write every field at the top level, and expect to find it under `metadata:` afterwards.**

### c2.C096
- key: Expect memq to read `tags:`, `created:`, `pinned:`, `machine:`, `supersedes:`, `anchors:` and `triggers:` at both the top level and inside the column-0 `metadata:` map, with the top-level value winning; a field under any other key or nested deeper is read at neither.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:116
- provenance: eecf17c 2026-08-24, the frontmatterValue reader in plugins/grimoire/scripts/memq.js.
- verdict: retire
- landed: f92e99ec section 5
- reason: Where memq looks and what wins is code, but a hand-written `tags:`, `pinned:` or `supersedes:` goes dark under any other key, so the placement bound stays as one sentence; the field enumeration retires (A149). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: (via A147) The rule, then one sentence: memq reads its fields at both placements, top-level winning, and a field under any other key or nested deeper is read at neither; memq's own writes and the archive move preserve shape.
- baseline-test: yes
- passage: memq reads its fields at both placements, the top-level value winning, and a field under any other key or nested deeper is read at neither.

### c2.C097
- key: Expect memq to strip one surrounding quote pair off a value read out of the `metadata:` map, so `tags: "gotcha, convention"` and the bare form match the same tags.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:118
- provenance: eecf17c 2026-08-24, the reader's own tolerance for the harness's quoting.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The strip is memq's reader's and bounded to the map placement; the rule a session obeys (c2.C098, do not quote by hand) stands without knowing that quoted map values work (A150).
- proposed: Delete the strip sentences from line 118; they live in this ledger under C097.

### c2.C098
- key: Do not quote a frontmatter value you write by hand; a top-level `tags: "a, b"` matches neither tag while printing as `[a,b]`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:118
- provenance: eecf17c 2026-08-24, installed with the placement rules.
- verdict: retire
- landed: f92e99ec section 5
- reason: The rule and its consequence stand, the printed `[a,b]` being what makes the failure invisible; only the four sentences of strip mechanics before it leave (A151). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: One sentence: do not quote a value you write by hand; a top-level tags: "a, b" matches neither tag while printing as [a,b].
- baseline-test: yes
- passage: **Do not quote a value you write by hand.** A `tags: "a, b"` typed at the top level matches neither `a` nor `b` while printing as `[a,b]`.

### c2.C099
- key: Write tags in the inline form only, `tags: a, b` on one line inside the `---` block at the top level; the YAML list form reads as no tags at all.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:124
- provenance: 8e22ff4 2026-07-31 for the inline form; the write-door guard came with 426bf68 2026-08-26 (plugins/grimoire/hooks/memory-frontmatter-guard.js).
- verdict: retire
- landed: f92e99ec section 5
- reason: The rule survives the guard, which refuses the list form only at the three write tools and only for a project-tier record, so a shell write and a record already on disk still need it; the "written at the top level" clause is line 116's and the guard's reach is the guard section's, both becoming pointers (A152). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: Two sentences: tags: a, b on one line inside the block; the YAML list form reads as no tags at all, which the frontmatter guard refuses at the write door for a project-tier record.
- baseline-test: yes
- passage: - **Frontmatter uses the inline form only**: `tags: a, b` on one line inside the `---` block. The YAML list form reads as no tags at all.

### c2.C100
- key: Expect the frontmatter guard to refuse a Write, Edit or MultiEdit carrying the YAML list tag form into a project-tier record at the write door.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:124
- provenance: 426bf68 2026-08-26, which stated what an anchor claims and what the write door refuses.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The guard section at line 302 owns what the guard refuses and where its reach ends, and the hook performs the refusal; this clause survives only as the pointer A152 keeps (A153).
- proposed: Fold into A152's pointer clause.

### c2.C101
- key: Keep the tag registry at `~/.claude/memory-types/tag-registry.md`: one tag per line with an optional one-phrase gloss, `#` comments and blank lines ignored.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:125
- provenance: 8e22ff4 2026-07-31, shipped with the tag vocabulary (parser at plugins/grimoire/scripts/memq.js:2241).
- verdict: keep
- reason: memq parses the file and writes none of its lines, so keeping the registry is a person's act (A154).
- passage: - **The registry** is `~/.claude/memory-types/tag-registry.md`: one tag per line, an optional one-phrase gloss after it.

### c2.C102
- key: Add a registry line before minting a tag; memq warns on any tag outside the registry and still writes the record.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:125
- provenance: 8e22ff4 2026-07-31, shipped with the registry.
- verdict: keep
- reason: The warning does not block the write, so the ordering is the author's to hold; the section states the warning beside the act it asks for and the command table row is the reference entry (A155, A156).
- passage: Add a line before minting a tag, since once the file exists `memq` warns on any tag outside the registry and still writes the record.

### c2.C103
- key: Expect no tag warnings while the registry file is absent, and every unregistered tag to warn once it exists, an empty file included; creating the file turns the control on.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:126
- provenance: 8e22ff4 2026-07-31 (existence check at plugins/grimoire/scripts/memq.js:2245).
- verdict: retire
- reason: row 882 (Tags inline and registry) shrink removes the registry on-switch mechanics. The act a session takes is still carried by c2.C102's "Add a line before minting a tag, since `memq` warns on any tag outside the registry and still writes the record.".
- passage: - **Absent registry, no warnings; present registry, authoritative.** A present file, an empty one included, makes every unregistered tag warn, so creating it is the deliberate act that turns the control on.

### c2.C104
- key: Start from the vocabulary `neo`, `neat`, `sql`, `gotcha` and extend freely; the decay pass folds in tag hygiene against the registry.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:127
- provenance: 8e22ff4 2026-07-31, the starter vocabulary shipped with the registry.
- verdict: retire
- reason: row 882 (Tags inline and registry) shrink removes the starter vocabulary. The tagging act is still carried by c2.C102's landed sentence.
- passage: - **Starter vocabulary**: projects (`neo`, `neat`), domains (`sql`), kinds (`gotcha`). Extend freely; the decay pass folds in tag hygiene against the registry.
- flag: environment

### c2.C105
- key: Write `machine: HOSTNAME` inline on one line at the top level, read there or under `metadata:`, with the value exactly as `os.hostname()` reports it on that box, compared caselessly.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:131
- provenance: e04fdf7 2026-08-30, the sweep verified by an instrument its author did not build, with the scope lesson in f86573e 2026-08-30 (comparison at plugins/grimoire/scripts/memq.js:3665).
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The value rule is the author's and stays, since a wrong spelling labels the record foreign on the very box its fact is true of, which is the sweep incident that installed the caseless comparison; the placement restatement belongs to line 116 and drops (A161). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: One sentence: machine: HOSTNAME, inline, with the value exactly as os.hostname() reports it on that box, compared caselessly.
- baseline-test: yes
- passage: The machine scope holds the hostname exactly as `os.hostname()` reports it on that box, compared caselessly.

### c2.C106
- key: Carry the `machine:` field on a fact true of one box, and omit it from a fact true of the operator generally or of a project.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:131
- provenance: e04fdf7 2026-08-30, the routing rule shipped with the field.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The routing rule stands, since nothing infers whether a fact is box-specific; the paragraph's form, placement, sync and re-validation sentences thin around it (A162).
- proposed: The field's form (A161), the routing rule, the write path with find's label.
- baseline-test: yes
- passage: A fact true of one box carries the field, and a fact true of the operator or of a project does not.

### c2.C107
- key: Write the field with `memq add-operator --machine <name>`; find's semantic channel labels a hit whose machine is not this one and drops the label when the value fails the identifier gate.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:131
- provenance: e04fdf7 2026-08-30 (write path and label at plugins/grimoire/scripts/memq.js:6174).
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Writing with `--machine` and reading find's foreign-machine label are acts and stay; the reader's re-validation against the identifier gate is the verb's own guarantee and belongs to docs/security-model.md, which carries the class (A163).
- proposed: Keep "written by memq add-operator --machine <name>; find's semantic channel labels a hit whose machine is not this one"; drop the re-validation clause to this ledger.
- passage: `memq add-operator --machine <name>` writes it, and `find`'s semantic channel labels a hit whose machine is not this one.

### c2.C108
- key: Keep a machine's configuration epoch at the canonical name `machine-configuration-epoch-<hostname>`, hostname lowercased, holding logical processors, physical memory, benchmark-moving environment settings and the date that configuration took effect.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:133
- provenance: 7ef71e3 2026-09-01, the instruments-not-prose plan; the record is machine-configuration-epoch-<hostname> on the operator tier.
- verdict: keep
- reason: Nothing checks a record against the canonical name, so holding to it is the author's act and the whole reason a figure can be placed against an epoch at all (A164). The hostname is in the name because the tier is shared and `add-operator` refuses to overwrite an existing name; that reason lives here rather than in the passage (A166).
- passage: `machine-configuration-epoch-<hostname>`, the hostname lowercased, holds the box's logical processor count, its physical memory, the environment settings that move a benchmark number, and the date that configuration took effect.

### c2.C109
- key: Author the epoch record through the CLI, `memq add-operator machine-configuration-epoch-<hostname> "<description>" --body-file <path> --machine <HOSTNAME>`, never by a Write into `memory-operator/`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:133
- provenance: 7ef71e3 2026-09-01, written with the epoch convention.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands as the tier rule applied to one record with the exact invocation it needs, the doctrine pointing here (A165, A167); the paragraph compresses and the hostname rationale moves to this ledger (A166).
- proposed: The canonical name and contents; the authoring invocation; the update-in-that-turn rule with its description clause; the fleet fork (C111).
- baseline-test: yes
- passage: Create it with `memq add-operator machine-configuration-epoch-<hostname> "<description>" --body-file <path> --machine <HOSTNAME>`, the machine value spelled as `os.hostname()` reports it.

### c2.C110
- key: Whoever observes a configuration change updates the epoch record in that turn with `--update --confirm-shared`, passing the mandatory description positional as the description the record should keep.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:133
- provenance: 7ef71e3 2026-09-01, installed with the epoch convention.
- verdict: keep
- reason: No group named it and A166 keeps it with its mandatory-positional clause, which earns its place because the epoch record's own closing line once named a flag combination the CLI refuses.
- passage: Whoever observes a configuration change updates it in that turn with `memq add-operator machine-configuration-epoch-<hostname> "<description>" --body-file <path> --update --confirm-shared`, passing the description the record should keep, since the update rewrites it.

### c2.C111
- key: Under the engine store signals, report a configuration change instead of writing it and leave the write to an attended session, but write a box's first epoch record with `--body`, which stays open there.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:133
- provenance: 7ef71e3 2026-09-01, extended by 2b6e936 2026-09-02 (grant hook at plugins/grimoire/hooks/memq-grant.js).
- verdict: keep
- reason: The refusals are enforced, but reporting the change in place of writing it is a duty nothing enforces (A168). The gate is blast-radius and stays: a whole-body replacement on a tier every machine reads, issued from an unattended worker (A169).
- passage: Under the engine store signals `--body-file` and a body-carrying `--update` are refused, so a fleet worker reports a change on a box whose record exists and leaves the write to an attended session. A box with no epoch record may still get its first one there with `--body`.

### c2.C112
- key: Before leaning on a durable figure whose value the box sets, compare the moment it was measured against the epoch record for the machine it was measured on.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:135
- provenance: 7ef71e3 2026-09-01, the instruments-not-prose plan that gave a measured figure a readable moment.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule stands and memory-system is its pinned owner, test/doctrine-parity.test.js:5590 counting this site's copy, so any rewrite must keep the expiry statement whole here and be re-verified against that pin; only the carve-out's justification and the named specimen record leave (A170 to A172). The parity pin is test/doctrine-parity.test.js:5622 (MOMENT_PIN_EXPIRY_OWNER) with its two patterns asserted at lines 5654 to 5665 at HEAD, and both patterns ('machine configuration epoch', 'read against that date before it is leaned on') sit once each in the landed text. Its landing respelled c2.C115's keep sentence; c2.C115 records the flip.
- proposed: The rules and classifications bare, with the carve-out stated and its reason in this ledger; re-verify the parity pin after the edit.
- baseline-test: yes
- passage: **A recorded measurement is read against that date before it is leaned on.**
- passage: Before using a durable figure whose value the box sets, such as a suite wall clock, compare the moment it was measured against the epoch record for the machine it ran on.
- flag: stale

### c2.C113
- key: Treat a pass/fail count as a property of the tree rather than the box, so it does not expire at an epoch boundary.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:135
- provenance: 7ef71e3 2026-09-01, the carve-out shipped with the expiry rule.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No program classifies a figure against the epoch; the reader does (A173). Its argument moves here: the pre-change tree a baseline came from can no longer be re-measured, so treating the count as expired would make the required delta report unproducible (A228). Flipped from keep to rewrite at section 22's close: c2.C151's retire dropped the delta clause, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: A pass/fail count is not one of those and does not expire at an epoch boundary: it is a property of the tree that produced it rather than of the box that ran it.
- passage: A pass/fail count is a property of the tree that produced it, not the box, and does not expire at an epoch boundary.

### c2.C114
- key: Treat a figure as expired when its moment predates the epoch, when it carries no moment at all, or when it was measured on a machine no epoch record covers.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:135
- provenance: 7ef71e3 2026-09-01, the expiry test shipped with the rule.
- verdict: keep
- reason: The classification is the reader's, exactly as c2.C113's is, and no instrument makes it (A174).
- passage: A figure is expired evidence when its moment predates the epoch, when it carries no moment, or when no epoch record at the canonical name covers its machine.

### c2.C115
- key: Where the box has no epoch record at the canonical name, write that box's epoch record first, or state the figure unplaceable and name the epoch write as what would settle it.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:135
- provenance: 7ef71e3 2026-09-01, installed with the expiry rule as its no-epoch branch.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No group named it and A171 keeps it among the rules stated bare; it closes the case where nothing can be compared, and configuration facts under some other name are ordinary operator-tier records rather than an epoch. Flipped from keep to rewrite at section 22's close: c2.C112's rewrite dropped the named specimen record, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: That third case obliges the same reading and one further act: the epoch is the canonical name or it is nothing, so a box whose configuration facts sit under some other name has no epoch to compare against, and the session that needs the comparison writes that box's epoch record first, or states the figure unplaceable and names the epoch write as what would settle it.
- passage: Where none covers it, write that box's epoch record first, or state the figure unplaceable and name the epoch write as what would settle it.

### c2.C116
- key: For an expired figure, either re-measure it and use the fresh reading, or state it as expired and unusable and name what would produce the real one.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:135
- provenance: 7ef71e3 2026-09-01, the expiry rule's exit, pinned by test/doctrine-parity.test.js:5590.
- verdict: keep
- reason: The doctrine's cannot-measure rule is general while this is the epoch rule with its re-measure exit, owned here; making this a pointer would break the parity pin, which reddens on a sixth copy (A175, A176). The pin sits at test/doctrine-parity.test.js:5654-5665 at HEAD, as c2.C112 records.
- passage: An expired figure is re-measured and the fresh reading used, or stated as expired and unusable, naming what would produce the real one.
- flag: stale

### c2.C117
- key: Never quote an expired figure as current, carry it into a comparison as though both readings shared a configuration, or repeat it onward.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:135
- provenance: 7ef71e3 2026-09-01, pinned by test/doctrine-parity.test.js:5590.
- verdict: keep
- reason: The doctrine bars unverified external specifics in forwarded artifacts; this bars an expired box figure and adds the spreading consequence, that a figure cited from an artifact spreads the expiry to every artifact citing it. Different subjects, and this site is the pinned owner (A177, A178). The pin sits at test/doctrine-parity.test.js:5654-5665 at HEAD, as c2.C112 records.
- passage: It is never quoted as current, never carried into a comparison as though both readings shared a configuration, and never repeated onward.
- flag: stale

### c2.C118
- key: Keep facts true of the operator or of a machine, rather than of one project or platform, in `~/.claude/memory-operator/`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:139
- provenance: 6cbb24a 2026-08-03, which added the operator tier and completed the routing ladder.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: A section's opening definition of its tier and its place in the ladder is not a rule copy of the routing test at line 141; the tier exists in code but what belongs in it is an authoring decision (A179 to A181). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: The operator tier holds facts true of the operator or of a machine rather than of one project or platform. It completes the routing ladder: journal, project, type, operator, doctrine.

### c2.C119
- key: Route by asking whether the fact would be true in a project you have not opened yet on any of your machines: yes is operator tier, true of every project of a type is type tier, about this codebase is project tier.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:141
- provenance: 6cbb24a 2026-08-03, installed when the operator tier completed the ladder; the type-tier section's own rung predates it (8e22ff4 2026-07-31).
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: This site states the whole ladder once and keeps it, including the clause that a fact true of one machine still lives in the operator tier with a `machine:` field; only the three worked examples per rung trim to the rungs themselves (A182 to A184).
- proposed: The routing question, the three rungs, and the one-machine clause, without the worked instances.
- baseline-test: yes
- passage: **The routing test: would this fact be true in a project you have not opened yet, on any of your machines?** Yes is the operator tier. True of every project of a type but not beyond it is the type tier. About this codebase is the project tier. A fact true of one machine only still lives here, with a `machine:` field naming the box.

### c2.C120
- key: Author operator-tier records only through `memq add-operator`, never a direct Write into `memory-operator/`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:143
- provenance: 6cbb24a 2026-08-03, with the tier; the ownership map assigns the shared tiers to memory-system and lists the doctrine's memory bullet as the pointer.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: Memory-system keeps the rule with its lock reason, that the tier is shared by concurrent sessions of every project and the Write tool cannot take the lock, and the doctrine points (A185, A186, A189). The project-tier correction-by-Write at line 201 is scoped to that tier and does not contradict it (A187). The paragraph compresses only by dropping the overwrite shapes (A188). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: Author only through add-operator with the lock reason; read the neighbours block; the two refusals; the pointer to repair and removal.
- baseline-test: yes
- passage: Author only through `memq add-operator`, since the frontmatter guard refuses every file write into a tier directory.

### c2.C121
- key: Read the neighbours block the verb prints before the write lands, and treat a `likely overlap` as the store saying the fact may already be recorded.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:143
- provenance: a3d8fbf 2026-09-06, after a kaizen note that the store had no write-time duplicate check (2026-09-04, now a `migrated` kaizen issue).
- verdict: keep
- reason: The block is printed but the judgment on a `likely overlap` is the author's, and the installing commit placed the instruction in both authoring paragraphs deliberately (A190, A191).
- passage: Read the neighbours block the verb prints before the write lands. A `likely overlap` there is the store saying the fact may already be recorded, and the four-remedies paragraph below chooses the remedy.

### c2.C122
- key: Expect `add-operator` to refuse to overwrite an existing name and to refuse a description over the 120-character cap rather than truncating it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:143
- provenance: 8f2b500 2026-08-08, which stated the input caps and made shared-tier overflow a refusal (cap at plugins/grimoire/scripts/memq.js:351).
- verdict: keep
- reason: An author choosing a name and a description acts on the refusals beforehand, and the caps were made refusals precisely because silent truncation had been permanent on the shared tiers; each tier's paragraph states its own verb's refusals (A192 to A194).
- passage: `add-operator` refuses an existing name and a description over the 120-character cap, never truncating it.

### c2.C123
- key: Reach overwriting by asking for it: `--update` replaces the index description, `--update` with a body flag and `--confirm-shared` replaces the body whole, and `delete-operator --confirm-shared` removes the record.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:143
- provenance: 752dbce 2026-08-22, the shared-tier repair-and-delete section.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 30 states the two update shapes and line 162 the delete, and this paragraph points at the repair-and-removal section immediately afterwards anyway; the flag semantics are the CLI's and are stated at their owning sites (A195 to A197).
- proposed: (via A195) Delete the overwrite-shapes sentence from line 143; the existing pointer carries the reader.

### c2.C124
- key: Read the "Repairing and removing a shared-tier record" section below for the repair and removal path.
- class: pointer
- source: plugins/grimoire/skills/memory-system/SKILL.md:143
- provenance: 752dbce 2026-08-22, installed with the repair-and-removal section it names.
- verdict: keep
- reason: No group named it, and A188 and A195 both lean on it: once the overwrite shapes retire, this pointer is what carries the reader to the owner.
- passage: See "Shared-Tier Repair and Removal" below.

### c2.C125
- key: Expect the operator tier not to be emitted at session start; reach it through `recall`, `find` and `get` so every use is visible to the read and applied stamps the decay clock runs on.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:145
- provenance: 6cbb24a 2026-08-03, on the session-start voice set by 70f4f8b 2026-08-02 (plugins/grimoire/hooks/memory-session.js).
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: That the tier is not emitted is the hook's, but the instruction to reach it through the three verbs so use stays visible is the reader's act and stays; the sentence loses only its trailing invisible-use clause (c2.C152), which restates line 102 (A198).
- proposed: Keep line 145's first two clauses; delete the "a memory recalled through an injected index" clause.
- baseline-test: yes
- passage: Session start emits none of the tier's records, so reach it through `recall`, `find` and `get`, which keep every use visible to the stamps the decay clock runs on.

### c2.C126
- key: The rationale for hiding archived records by default is that they would be noise requiring re-classification on every search.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 4fe812b 2026-08-03, the withhold commit that recorded the reason with the default.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The default and the rerun are stated plainly and are obeyed without the reason (A199); the reason is held here, that a retired record among live answers is noise a caller would re-classify on every search. Its landing respelled c2.C010's keep sentence; c2.C010 records the flip.
- proposed: Delete the "because a retired record among live answers is noise" clause.

### c2.C127
- key: The applied count and age are printed as two separate tokens because a single combined figure would be ambiguous between an age and a tally.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 1f4934e 2026-08-04, written with the two-token display.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The tokens and how to read them are stated either side of the clause; the ambiguity argument adds nothing to act on (A200).
- proposed: Delete the "They are two facts and they are printed as two" sentence.

### c2.C128
- key: Expect a superseded record to be demoted in the semantic ranking by a fixed constant, so an equally similar non-superseded record outranks it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: b5c0a98 2026-08-23, the supersedes effort (semantic ranker in plugins/grimoire/scripts/memq.js).
- verdict: retire
- landed: d2c43f1 section 22
- reason: The constant is the ranker's, and the remedies paragraph already states that supersession demotes, which is all a reader needs (A201 to A203).
- proposed: (via A201) Delete the "demoted in the semantic ranking by its own constant" clause from line 46.

### c2.C129
- key: The model-judged block exists to catch a record that is topically close to the query but useless for the actual problem.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 050587b 2026-08-30, written with the block's description.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The block's presence, label and advisory status are stated and acted on; its purpose is background (A204). Its landing respelled c2.C016's keep sentence; c2.C016 records the flip.
- proposed: Delete the "which is the pass that catches a record topically close" clause.

### c2.C130
- key: Read `docs/security-model.md` for the full account of what the model-judged block sends off-machine and how.
- class: pointer
- source: plugins/grimoire/skills/memory-system/SKILL.md:46
- provenance: 050587b 2026-08-30, installed with the channel's exposure disclosure.
- verdict: keep
- reason: No finding named it. The pointer is what keeps the exposure disclosure (c2.C019) short while leaving the full account with its owner.
- passage: which `docs/security-model.md` describes in full.

### c2.C131
- key: The type, operator, and pending tiers each stay lean in the digest for a distinct reason tied to how each tier's content reaches the session.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:50
- provenance: 70f4f8b 2026-08-02, which set each surface's line shape and recorded why.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The lean-tier fact is stated before the clause and the three per-tier reasons are design background (A205). Its landing respelled c2.C026's keep sentence; c2.C026 records the flip.
- proposed: Delete the three "because" clauses from line 50.

### c2.C132
- key: Project lines carry a provenance line under a store pin because the writer of those records is not the session reading them.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:50
- provenance: 70f4f8b 2026-08-02, written with the provenance fence.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The indent under a pin is stated as a fact (c2.C027) and acted on there; the reason is background (A206). Its landing respelled c2.C027's keep sentence; c2.C027 records the flip.
- proposed: Delete the "because the worker that wrote them" clause.

### c2.C133
- key: The project tier is cut first under budget pressure because it has the most alternative paths to reach it.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:50
- provenance: f270e9c 2026-07-31, written with the budget logic.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The cut order itself retires under A056 and its reason goes with it (A207); both are recorded here for anyone changing the recall renderer.
- proposed: (via A056) Delete the cut-order sentence and the project-first reason from line 50; both live in this ledger under C029 and C133.

### c2.C134
- key: The digest's provenance-line fence for type- and operator-derived content is the same fence `get` puts around those bodies, and the reason to treat that content as data is that the type tier is written by every project declaring that type and the operator tier by every project on the machine.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:52
- provenance: f270e9c 2026-07-31 for the fence; the cross-reference to get's fence came with 6cbb24a 2026-08-03.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 38 owns get's fence, and the cross-reference and the tier-authorship reason both leave with A057's rewrite while the fence rule stays in c2.C030's sentence (A208 to A210). The authorship reason lives here: the type tier is written by every project declaring that type and the operator tier by every project on the machine.
- proposed: (via A057) Keep "indented under a provenance line; column zero is memq's own voice"; replace "data to weigh rather than instruction to follow" with a pointer at the doctrine; drop the "written by every project" reason.
- baseline-test: yes

### c2.C135
- key: Expect `find`'s output to close with the applied-stamp reminder whenever a shown hit is one `touch` can reach.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: 6cbb24a 2026-08-03 (reminder printed by find in plugins/grimoire/scripts/memq.js).
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reminder is printed by the verb, its placement is the verb's, and the habit it triggers is c2.C078's; nothing is lost by deleting the sentence (A211).
- proposed: Delete the "Find's output closes with that reminder" sentence from line 54.

### c2.C136
- key: `--update` refuses against a retired-only name because a caller using it believes they are editing a record that still exists.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:54
- provenance: 752dbce 2026-08-22, written with the retired-name branches.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal it explains retires with c2.C038, so its reason goes to this ledger with it (A212).
- proposed: (via A072) Delete the four sentences from "A create proceeds" to "carrying a body at all"; the mechanics live in this ledger under C038.

### c2.C137
- key: Read the write surface a record landed on as its own provenance: journal entries and applied stamps exist only through `memq`, while a project-tier memory file arrives through the Write tool.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:58
- provenance: 31240d3 2026-08-01, the recap section written to teach exactly this inference.
- verdict: retire
- landed: f92e99ec section 5
- reason: The grouping is printed and the reading is not; this inference is the point the section exists to make (A213). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: Journal entries and applied stamps exist only through `memq`, while a project-tier memory file arrives through the Write tool, so the surface a record landed on is its own provenance.

### c2.C138
- key: Dating archived files by rename rather than mtime is what lets a decay pass's demotions read as file changes instead of vanishing.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:58
- provenance: 31240d3 2026-08-01, written beside the dating fact.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The dating is memq's and the sentence explains a mechanism no act turns on (A214).
- proposed: Delete the "Archived files answer to the clock a rename moves" sentence.

### c2.C139
- key: The `added` label reports that the file's creation time falls inside the window, and it resets on every edit because the writing tools rewrite the file rather than patching it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:60
- provenance: c46cd9e 2026-08-01, which stated what the label actually means after a live close-out misread it.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The label's meaning and its reset are the programs', and the consequence a reader acts on, that an edit reports `added` too, stays in c2.C040's sentence (A215).
- proposed: (via A076) Two sentences: do not read added as new, since an edit reports added too; read the names against what the effort wrote when the recap must say which are new.
- baseline-test: yes

### c2.C140
- key: The PASS/FIXED gate covers only the leak probes and the store's index state, an outbound half narrower than what the manual pull-and-push pair actually needs.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: 6f026b1 2026-09-07 and the git-guard plan's close ddcb28e 2026-09-08, whose security review installed the disclosure.
- verdict: retire
- reason: row 874 (Doctor -Fix and manual push) shrink removes the gate-narrowness argument. c2.C050's landed sentence still carries its consequence: "...which also takes the sync lock and screens incoming content.".
- passage: That gate is the outbound half, the leak probes and the index state, and the pair needs more: it takes no lock against the background sync and screens no incoming tree.

### c2.C141
- key: Expect a hand-run `sync-store.ps1` push to lack `GIT_SSH_COMMAND` and `GIT_ASKPASS` even if the calling shell relied on them, because its git calls carry the unattended run's environment guard.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: 9012fd8 2026-09-07, which named the hand run's dropped credential variables where the hand run is prescribed (guard at plugins/grimoire/doctor/sync-store.ps1:8).
- verdict: retire
- reason: row 874 (Doctor -Fix and manual push) shrink removes the environment-guard detail. c2.C142's landed pointer "`docs/security-model.md` states what each hand path leaves exposed." carries it to `docs/security-model.md`, which covers `GIT_ASKPASS` at line 98 and the hand-path exposure at lines 152 and 704.
- passage: Its git calls take the unattended run's environment guard, so a shell that relied on `GIT_SSH_COMMAND` or `GIT_ASKPASS` for its push has neither there.

### c2.C142
- key: Read `docs/security-model.md` for what each hand sync path leaves exposed.
- class: pointer
- source: plugins/grimoire/skills/memory-system/SKILL.md:66
- provenance: 9012fd8 2026-09-07, installed with the hand-path disclosures.
- verdict: keep
- reason: No finding named it, and A088's restructure keeps it: it is what lets the paragraph carry one clause per disclosure instead of the full account.
- passage: `docs/security-model.md` states what each hand path leaves exposed.

### c2.C143
- key: The PowerShell 5.1 quote-mangling is a parsing hazard rather than an injection hazard, and is a separate issue from the `cmd.exe` shim's argument forwarding.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:86
- provenance: 8f2b500 2026-08-08, written with the quote-hazard account.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The composing rule stands in the bold lead and the shim story compresses under A098; the classification is background, held here so the two hazards are not re-conflated (A218).
- proposed: (via A098) The three rules, then two sentences: a stored body is the one thing unsafe to paste onto a cmd.exe line; PowerShell 5.1 breaks an argument carrying an embedded quote before memq runs and memq prints a hint naming that cause, so quote-free one-line prose is safe on every path.

### c2.C144
- key: `unstamped` exists because both the in-turn stamp and the close-out recall are prone to failure under real working conditions.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:96
- provenance: a0edaed 2026-08-25, the round whose own amendment was to state the trigger bare and name no causes.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Every cause attached to this trigger proved false in some state, and the repair the effort itself made was to delete them; this sentence is one of those causes (A219). Its landing respelled c2.C073's keep sentence; c2.C073 records the flip.
- proposed: (via A118) Two sentences: unstamped diffs reads against applied stamps in a window and hands back the gap; executing-work runs it at every Chapter boundary and finishing-work as a final sweep before the decay pass.
- baseline-test: yes

### c2.C145
- key: Expect the `unstamped` report's list to miss a record read inside the window then archived before the sweep, and any record cleared by an applied stamp anywhere in the window; widening the window can therefore drop records a narrower one would have raised.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:106
- provenance: a0edaed 2026-08-25, disclosed with the two-instruments rule.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The blind spots are properties of the command's list and the rule they motivate, setting your own account against the report, stands without them; the window rule they explain is executing-work's and finishing-work's, both of which state it (A220). The two blind spots are recorded here so a later reader does not rediscover them as a defect.
- proposed: (via A138) State the two-instruments rule, the walk-adjudicate-stamp procedure with its discharge condition, and the note-in-record rule; move the blind-spot list to this ledger.
- baseline-test: yes

### c2.C146
- key: `get` stamps a read on every body it serves, archived bodies included, and a live record stamped this way shows up as a hit at the next boundary with no marker that a hand walk was the reader.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:110
- provenance: a0edaed 2026-08-25, written with the hand walk as the mechanism behind c2.C090.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 23's row and get's own paragraph state that get stamps; this is the mechanism behind a rationale that itself retires (A221 to A223). It is held here because it is why the walk names opened records in the boundary's record (c2.C091).
- proposed: (via A143) Delete the "because get stamps a read" clause from line 110.

### c2.C147
- key: Expect the harness rewrite to leave the top level with either an empty `name:` field or the record's name paired with a `description:` field.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:114
- provenance: eecf17c 2026-08-24, disclosed with the rewrite.
- verdict: retire
- landed: d2c43f1 section 22
- reason: memq's reader keys on the `metadata:` map's shape, so no reader needs the marker-key variants, and the passage itself says which variant you get varies by harness version (A224).
- proposed: (via A144) One sentence: on Claude Code a Write into a project's memory directory is rewritten in the same second, your top-level keys moving under a column-0 metadata: map beside keys of the harness's own.

### c2.C148
- key: `memq` locates fields by the `metadata:` map's presence alone, never by the harness's own marker keys, which is why it reads every rewritten variant.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:116
- provenance: eecf17c 2026-08-24, the frontmatterValue reader's strategy.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The keying strategy is in code and no act turns on it (A225); it is recorded here because it is why c2.C147's variant list is unnecessary.
- proposed: (via A147) The rule, then one sentence: memq reads its fields at both placements, top-level winning, and a field under any other key or nested deeper is read at neither; memq's own writes and the archive move preserve shape.

### c2.C149
- key: Query tags with `memq find --tag <t>`; tags are an optional list on memory frontmatter and journal entries.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:122
- provenance: 8e22ff4 2026-07-31, the tags section's opening definition.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The flag exists but issuing the query is the caller's act, and the sentence is what tells a reader tags are queryable at all (A226). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Tags are an optional list on records and journal entries, set with `--tag` and queried with `memq find --tag <t>`, from a controlled vocabulary.

### c2.C150
- key: The tag vocabulary is controlled because unmanaged tags decay into synonyms that make `--tag` queries silently incomplete.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:122
- provenance: 8e22ff4 2026-07-31, written with the registry.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The registry rule states the control and is obeyed without the argument (A227); the argument is held here, that unmanaged tags decay into synonyms and make `--tag` queries silently incomplete.
- proposed: Delete the "because unmanaged tags decay into synonyms" clause.

### c2.C151
- key: A pass/fail baseline is exempted from epoch expiry because the pre-change tree it came from can no longer be re-measured, so treating it as expired would make the required delta report unproducible.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:135
- provenance: 7ef71e3 2026-09-01, the argument that dissolved a reviewer's request for a machine field on the Chapter template.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The carve-out (c2.C113) is stated before the clause and obeyed without it; this argument is exactly what the ledger exists to hold, so the carve-out is not re-litigated as an oversight (A228). Its landing respelled c2.C113's keep sentence; c2.C113 records the flip.
- proposed: (via A171) The rules and classifications bare, with the carve-out stated and its reason in this ledger; re-verify the parity pin after the edit.
- baseline-test: yes

### c2.C152
- key: A memory reached through an injected index rather than through `recall`, `find`, or `get` is used invisibly, and its decay clock ages it as though it were never used.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:145
- provenance: 6cbb24a 2026-08-03 on the session-start voice of 70f4f8b 2026-08-02; the untracked-reader class was drawn whole in f1e3363 2026-08-25.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 102 owns the untracked-reader class and the Known limits bullet names the index-in-context case with its remedy, a pin; this clause is the third statement of one member (A229).
- proposed: (via A198) Keep line 145's first two clauses; delete the "a memory recalled through an injected index" clause.
- baseline-test: yes

### c3.C001
- key: Opt a project into a type tier by putting a `Project-Type: <type>` line in the first ten lines of its own memory `MEMORY.md`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:149
- provenance: 8e22ff4 2026-07-31, the memory-extension plan that shipped the shared project-type tier (docs/archive/claude-kit_memory-extension_spec_v1.md).
- verdict: keep
- reason: The opt-in is a hand edit the hook only reads; nothing writes the line for a project, so the instruction is the one place a session learns how to opt in.
- passage: A project opts in with a `Project-Type: <type>` line in the first ten lines of its memory `MEMORY.md`

### c3.C002
- key: Put a fact in the type tier only when it holds for every project of that type, not just the one that taught it.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:151
- provenance: 8e22ff4 2026-07-31, installed with the type tier; the three-rung routing ladder at line 141 arrived later with the operator tier and states this rung whole.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The ladder at line 141 owns routing; this section keeps one sentence naming its rung and the starter types and points at the ladder for the test (A002 to A004). Nothing adjudicates tier membership, so the rung itself is not retired. Lands with the pointer at the ladder worded 'on the routing test the operator tier section states' rather than by line number, since line numbers move.
- proposed: One sentence for the rung plus the starter-types clause, the rest pointing at line 141.
- proposed: (via A002) Compress line 151 to one sentence stating the type-tier rung and the starter types, pointing at the routing ladder at line 141 for the test.
- baseline-test: yes
- passage: **A fact belongs in the type tier only when it holds for every project of that type, not just the one that taught it**, on the routing test the operator tier section states. Starter types are `nextjs` and `dotnet`.

### c3.C003
- key: Test type-tier candidacy by asking whether a project of that type you have never opened would act on the fact correctly.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:151
- provenance: 8e22ff4 2026-07-31, installed with the type tier; the same question is asked over all three tiers at line 141.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A duplicate of the ladder's never-opened-project question at line 141, which owns it; the test is the author's to apply and survives there whole (A005 to A007).
- proposed: (via A005) Drop the test sentence from line 151; line 141 carries it.
- baseline-test: yes

### c3.C004
- key: Keep a fact that names a specific project in that project's own store.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:151
- provenance: 8e22ff4 2026-07-31, installed with the type tier; line 141's third rung states it, and the kaizen skill's bullet at line 33 already points at the memory tier.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A duplicate of the ladder's project-tier rung at line 141; kaizen's parenthetical is already a pointer and changes nothing (A008 to A010).
- proposed: No change to kaizen; line 151's sentence drops per A008.
- proposed: (via A008) Drop the sentence from line 151.
- baseline-test: yes

### c3.C005
- key: Mint new types freely through `add-type`, naming each for the platform or framework that dictates the conventions.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:151
- provenance: 8e22ff4 2026-07-31, installed with the type tier.
- verdict: keep
- reason: The verb mints and does not judge the name, so the naming convention has no machinery behind it.
- passage: Mint new ones freely through `add-type`, named for the platform or framework that dictates the conventions.

### c3.C006
- key: Author type-tier records only through `memq add-type`, never with a direct Write into `memory-types/`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:153
- provenance: 8e22ff4 2026-07-31 installed the rule with the tier; 426bf68 2026-08-26 made the frontmatter guard refuse every write tool on both shared tiers (test/memory-frontmatter-guard.test.js:1005).
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The positive instruction stays as the section's rule; the Write bar is now the guard's refusal and is stated by pointer rather than argued, with the doctrine's line 82 and row 30 as pointers (A012 to A015). test/memory-frontmatter-guard.test.js:1005 at HEAD asserts the --update create-form hint on stderr rather than the every-write-tool refusal on both shared tiers, so that pin is re-located by content rather than by this line number. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: Two instructions and the repair-section pointer; the rest moves as the cited rulings say.
- proposed: (via A013) Keep "Author only through `memq add-type`", state the Write bar as the guard's refusal by pointer, and leave rows 30 and 54 as pointers.
- baseline-test: yes
- passage: Author only through `memq add-type`.
- passage: An overwrite takes an explicit request, under "Shared-Tier Repair and Removal" below.

### c3.C007
- key: Treat the tier as genuinely shared by concurrent sessions of different projects, whose writes serialize under a lock the Write tool cannot take.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:153
- provenance: 8e22ff4 2026-07-31, the reason the tier is CLI-authored: the type tier's writes serialize under a lock and the Write tool cannot take one.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Since 426bf68 the guard refuses the write tools on both shared tiers mechanically, so the rule is obeyed by meeting the refusal; the lock account is why the design has that shape and lives here (A016).
- proposed: Move the lock account to the ledger; the rule names the guard.
- baseline-test: yes

### c3.C008
- key: Read the neighbours block the verb prints before the write lands.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:153
- provenance: a3d8fbf 2026-09-06, section 3 of the write-time-neighbours plan, which put the instruction into both shared-tier authoring paragraphs so an author reads the store's answer before writing a duplicate.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The block warns and never gates, so reading it is the author's act; the verb rows describe the block and this sentence is the instruction, neither the other's copy (A017, A018). Flipped from keep to rewrite at section 22's close: c3.C009's retire dropped the since clause, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Read the neighbours block the verb prints before the write lands.
- passage: Read the neighbours block the verb prints before the write lands. An overwrite takes an explicit request

### c3.C009
- key: Treat a duplicated type-tier fact as served to every project of the type.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:153
- provenance: a3d8fbf 2026-09-06, the reason the read-the-block instruction was installed for the type tier.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The instruction is obeyable without it; a duplicate on the type tier is served to every project declaring the type, which is why the block exists (A019). Its landing respelled c3.C008's keep sentence; c3.C008 records the flip.
- proposed: Drop the "since a duplicated type-tier fact ..." clause; the ledger holds it.
- baseline-test: yes

### c3.C010
- key: Expect `add-type` to refuse an existing name and to refuse a description over the 120-character cap rather than truncating it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:153
- provenance: 8f2b500 2026-08-08, "state the input caps, refuse shared-tier overflow", which installed both refusals in memq and the prose.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Both refusals are the verb's own and tested (test/memq.test.js:6086, 10534), and row 30 states the caps with the compose-to-size instruction; the section's repeat adds nothing (A020 to A022).
- proposed: (via A020) Drop the two-refusals sentence from line 153, keeping its pointer to the repair section.

### c3.C011
- key: Repair a shared-tier record whole, delete it outright, or state its recognition line whole with `memq triggers ... --replace`, under the same lock and `--confirm-shared`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:157
- provenance: 752dbce 2026-08-22 opened the repair-and-delete section with this inventory; 9b1180b 2026-09-03 added the `--replace` shape when a wrong recognition declaration became correctable.
- verdict: rewrite
- landed: c822a4e8 section 6
- reason: The inventory of what a shared tier admits is where a session chooses among repair, delete and replace, and choosing is the author's act (A023 to A025). Rewritten on 2026-10-04 by section 6 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which sent the shared-tier deletes through the memory database, so they take no lock; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Both shared tiers take a whole-body repair, a true delete and a recognition line stated whole (`memq triggers ... --replace`), under the same `--confirm-shared` consent as their other shared work.

### c3.C012
- key: Compose a shared-tier write carefully because every project and machine sharing the tiers reads it.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:157
- provenance: 752dbce 2026-08-22, written when the tiers stopped being write-once so that care is asked for the right reason, reach rather than permanence.
- verdict: keep
- reason: The rule and its reason are one sentence; the paragraph's compression comes from c3.C013's retirement (A026).
- passage: Compose carefully because every project and machine sharing the tiers reads them, not because a mistake is permanent.

### c3.C013
- key: Treat `--confirm-shared` as a flag rather than a person, and expect the unattended fleet vector to refuse the delete verbs, the body repair and `--replace` outright, leaving demotion only.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:157
- provenance: ae2c70a 2026-08-22 installed the caveat in the whole-file read against the shipped CLI; 9b1180b 2026-09-03 restated it inside the unattended-vector paragraph at line 166.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Every refusal it names is memq's own under the engine store signals (memq.js:10889, :3387; test/memq.test.js:20884) and line 166 states each with its reason and the flag-not-a-person caveat; line 157 keeps a pointer (A027 to A030).
- proposed: (via A028) Replace the caveat sentences at line 157 with a pointer at the unattended-vector paragraph.
- baseline-test: yes

### c3.C014
- key: Repair with `add-type <type> <name> "<description>" --body "..."` (or `--body-file <path>`) `--update --confirm-shared`, or the operator twin; it replaces the body whole with no patch grammar.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:159
- provenance: 752dbce 2026-08-22 shipped the whole-body repair; c56a8b5 2026-08-21 gave bodies the `--body-file` channel no shell can mangle.
- verdict: keep
- reason: The four-remedies section owns repair per the ownership map; the command's spelling is what the caller composes, and row 30 and the decay pass's summarize rung are the pointer and the sibling moment (A031 to A033).
- passage: **Repair** is `add-type <type> <name> "<description>" --body "..."` (or `--body-file <path>`) `--update --confirm-shared`, and the operator twin. It replaces the body whole

### c3.C015
- key: Pass the description the record should keep on a repair rather than a throwaway, since the mandatory positional rewrites the index line every project reads.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:159
- provenance: 752dbce 2026-08-22 made the description positional mandatory on the repair path; ae2c70a 2026-08-22 stated the consequence for the index line.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The verb demands a description and cannot judge whether it is the one the record should keep (A034). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: the mandatory description rewrites the one every project reads, so pass the one the record should keep.

### c3.C016
- key: Delete and rewrite the record when it needs different tags, a different machine scope, or a different pointer, because repair refuses `--tag`, `--supersedes`, `--trigger` and `--machine`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:159
- provenance: 8f2b500 2026-08-08 set tags at creation and named the delete-and-rewrite remedy; 752dbce, b5c0a98 and 9b1180b widened the creation-only set to machine, pointer and triggers.
- verdict: keep
- reason: This is the whole creation-only field set with its remedy; row 30's tags clause is the narrower copy (A035 to A037).
- passage: Repair refuses `--tag`, `--supersedes`, `--trigger` and, on the operator twin, `--machine`, so such a change is a delete and a fresh write.

### c3.C017
- key: Declare recognition triggers after creation with `memq triggers <name> <type>:<pattern> --operator` or `--type=<type>`, which merges into the existing line, or writes it whole under `--replace --confirm-shared`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:159
- provenance: 9b1180b 2026-09-03, the carve-out written when triggers became correctable, so a trigger change is not routed to the repair bullet's delete-and-rewrite remedy.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The repair bullet keeps one clause saying triggers are the creation-only field whose remedy is not a delete, pointing at the triggers section, which owns both doors, the merge and the replace (A038 to A040).
- proposed: (via A038) Reduce to one clause pointing at the triggers section.
- baseline-test: yes
- passage: Triggers are the exception, which the triggers verb corrects in place.

### c3.C018
- key: Expect a repair to keep one generation of the previous body in a `.bak` beside the record, which never leaves the machine.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:159
- provenance: 752dbce 2026-08-22, the rewriteWithBackup sites shipped with repair; line 184 (0d1e610 2026-08-30) later stated the single backup generation as the shared property of the three verbs that spend it.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The backup is program behavior a shared-tier caller never handles (the delete sweeps it), and line 184 owns the statement (A041). Lands with one sentence in the Repair bullet stating what a `.bak` a repair, a rollup or an `anchor` run leaves is worth in a shared tier (one generation deep, one machine's, never synced), since finishing-work step 8 points at this document for that statement and line 184's copy speaks of `anchor` alone.
- proposed: Drop the `.bak` sentence from the repair bullet; line 184 owns it.

### c3.C019
- key: Delete with `delete-type <type> <name> --confirm-shared` or the operator twin, which removes the live record, any archived copy, both index lines, local usage stamps, `.bak` and `.tmp.<pid>` copies, and the three index and usage backups.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:160
- provenance: 752dbce 2026-08-22 shipped the delete verbs and their sweep; ae2c70a 2026-08-22 added that the stamp removal is local hygiene under union-merging sidecars.
- verdict: retire
- landed: 54629b25 section 6
- superseded-by: E007
- reason: Rows 32 and 33 carry the same removal list nearly word for word and are the verb's reference; the bullet keeps the command, the stamps caveat a session weighs before deleting, and c3.C020 and c3.C021, pointing at the row for the sweep (A042 to A044). Lands as the Delete bullet keeping the removal inventory: c1.C080 cut the delete-type row to its signature, the lock, the declaring-projects line and the without-flag refusal with a pointer at this bullet, so the bullet is the inventory's one owner and the row points here. Retired on 2026-10-04 by section 6 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the shared-tier deletes mark the record's database row deleted and removed no file, so the removal inventory this passage states is gone, and E007's passage carries the bullet; the verdict before it was rewrite.
- proposed: (via A042) Replace the bullet's removal list with "removes everything the `delete-type` row lists, in one locked operation", keeping the stamps caveat.
- passage: **Delete** is `delete-type <type> <name> --confirm-shared`, and the operator twin. In one locked operation it removes the record, its archived copy, its index lines and its usage stamps.

### c3.C020
- key: Check the record name before confirming a shared-tier delete.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:160
- provenance: ae2c70a 2026-08-22, from the whole-file read that found a mistyped name under `--confirm-shared` spends the three backups and reports nothing; the behavior change is parked on the backlog (docs/backlog.md:159).
- verdict: retire
- landed: 54629b25 section 6
- superseded-by: E007
- reason: The defect is still open, so the incident recurs and no machinery catches it; the rule is the only guard (A045). Retired on 2026-10-04 by section 6 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the shared-tier deletes mark the record's database row deleted and removed this passage: the host answers a name it holds no live row of as absent and the verb refuses it, which E007's passage states; the verdict before it was keep.
- passage: Check the name before you confirm, because a name the tier does not hold is not refused.

### c3.C021
- key: Settle a modify/delete conflict from another machine as a human git operation in the store checkout, since the sync aborts the rebase and nothing syncs until it is resolved.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:160
- provenance: 752dbce 2026-08-22 stated the conflict when delete met a self-syncing store; the operator-tier record memory-store-divergence-is-a-union-with-two-traps records the runner standing down on a real divergence.
- verdict: retire
- landed: 54629b25 section 6
- reason: The gate is blast-radius: a wrong resolution pushes a half-merged shared tier to a remote a second machine pulls, and no program resolves it (A046, A047). Retired on 2026-10-04 by section 6 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the shared-tier deletes mark the record's database row deleted and removed this passage: a delete removes no file, so it meets no git conflict in the store checkout; the verdict before it was keep.
- passage: A delete of a record another machine has since modified stalls the sync until a human settles the git conflict in the store checkout.

### c3.C022
- key: Delete the record that was never true: a mistake, a fact wrong when written, or a body that says something you did not mean.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: b5c0a98 2026-08-23, the supersedes plan, which stated all four remedies and routed between them by what went wrong (docs/archive/claude-kit_memory-supersedes_spec_v1.md).
- verdict: keep
- reason: The four-remedies paragraph is the owner per the ownership map; the doctrine's line 108 (c289f91 2026-07-12) routes the same cases to two remedies and gives way to this owner, which is a real contention ruled against the doctrine side (A048 to A052). At HEAD the doctrine's memory-contradicted bullet points at this paragraph's four remedies (a2ca9e5).
- passage: Delete is for the record that was **never true**: a mistake, a fact wrong when written, a body that says something you did not mean.

### c3.C023
- key: Repair the record whose fact is right and whose body is wrong, replacing the text whole and keeping its name and history.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: b5c0a98 2026-08-23, the supersedes plan's statement of the four remedies.
- verdict: keep
- reason: One of the eight routing rules the paragraph keeps whole under A051; no finding of its own.
- passage: Repair is for the record whose **fact is right and whose body is wrong**, so the text is replaced whole and the record keeps its name and history.

### c3.C024
- key: Supersede the record that was right and is stale now by writing a new record carrying the answer with `--supersedes` pointing back.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: b5c0a98 2026-08-23, the supersedes plan; a kaizen note of 2026-09-04 (now a `migrated` kaizen issue) records that the predecessor stays live and recallable until a decay pass prunes it.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The owner of the remedy; the doctrine's update-in-place gives way to it (A053), and any rewrite of the doctrine side should not promise that supersession alone settles a contradiction, since both records answer a recall until the prune. Flipped from keep to rewrite at section 22's close: c3.C025's retire removed the effect list after it, so the sentence was respelled to stand as landed. Landed as the proposal below. At HEAD the doctrine's memory-contradicted bullet points at this paragraph's four remedies (a2ca9e5).
- proposed: Supersede is for the record that **was right and is stale now**: the fact has been overtaken, so a new record carries the answer and points back at the old one with `--supersedes`.
- passage: Supersede is for the record that **was right and is stale now**: the fact has been overtaken, so a new record carries the answer and points back at the old one with `--supersedes`.

### c3.C025
- key: Expect `--supersedes` to label the old record on `find`'s two channels, `recall`, `get` and `decay-scan`, demote it in semantic ranking, make it an archive candidate at the next decay pass, and leave it live and fetchable.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: b5c0a98 2026-08-23, the supersedes plan's effect list, each effect built into a read surface.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Every effect is stated at the surface that produces it (lines 38, 46, 50, 272) with detail this list lacks, and each is pinned (test/memq.test.js:20060 to 20748); the paragraph keeps a one-clause pointer and the index-unlabeled note (A056 to A058). Its landing respelled c3.C024's keep sentence; c3.C024 records the flip.
- proposed: (via A056) Replace the effect list with one clause: the pointer labels and demotes the old record on every read surface and nominates it for archive, the surfaces' own sections stating how; keep the note that the `MEMORY.md` index line stays unlabeled, which no other section states.

### c3.C026
- key: Archive the record that aged out with `decay-prune`, moving it to the tier's `archive/` where it stays reachable by name.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: b5c0a98 2026-08-23, the supersedes plan's statement of the fourth routed remedy.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: One of the routed remedies with its subject; line 38 states reachability as `get`'s note and is not a copy (A059, A060). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Archive, which `decay-prune` performs, is for the record that **aged out**: it is marked archived, off the live answers but still reachable by name.

### c3.C027
- key: Route between the four remedies by what went wrong, not by how much you dislike the record.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: b5c0a98 2026-08-23, the supersedes plan's routing question.
- verdict: keep
- reason: The routing question itself, kept whole under A051; no finding of its own.
- passage: Route by what went wrong, not by how much you dislike the record.

### c3.C028
- key: Choose the remedy yourself for a neighbour pair the decay scan nominates, since the scan names the pair and picks none of the four.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: a3d8fbf 2026-09-06, added when the decay scan gained its neighbour-pairs block, so the scan nominates and never picks.
- verdict: keep
- reason: The scan names pairs and no program adjudicates which record was never true, stale or badly worded; kept whole under A051.
- passage: The decay scan's neighbour-pairs block nominates unlinked live pairs that read as one fact and picks none of the four remedies, so which record was never true, stale or badly worded is your judgment over the two bodies.

### c3.C029
- key: Reach for delete when another project reading it would embarrass you, repair when only the wording failed, supersession when you are about to write the replacement, and archival when you no longer need it surfaced.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: 752dbce 2026-08-22 wrote the practical form for delete and repair; b5c0a98 2026-08-23 extended it to four.
- verdict: keep
- reason: The owner's practical routing; the doctrine's two-condition line gives way to it (A061). At HEAD the doctrine's memory-contradicted bullet points at this paragraph's four remedies (a2ca9e5).
- passage: Reach for delete when you would be embarrassed to have another project read it, repair when only the wording failed, supersession when you are about to write the replacement, and archival when you no longer need it surfaced.

### c3.C030
- key: Treat a record carrying a credential, connection string or anything needing rotation as a delete plus a rotation, whatever else is true of the fact.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: b5c0a98 2026-08-23, the cross-cutting case added to the four remedies; line 164 (752dbce 2026-08-22) is the rotation rule it routes to.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Keeps its routing role (a secret is a delete) and drops the reason it repeats from line 164, which owns the rotation rule with its history-and-machines account (A062, A063).
- proposed: (via A062) Keep "a record carrying a credential is a delete plus a rotation" as the routing clause and point at the deletion paragraph for why the other three remedies do not suffice.
- baseline-test: yes
- passage: A record carrying a credential, a connection string or anything needing rotation is a delete plus a rotation, whatever else is true of it. The deletion paragraph below says why even that is not a redaction.

### c3.C031
- key: Expect supersession to need no `--confirm-shared`, since the command writes only the new record.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: b5c0a98 2026-08-23, the design note on why the fourth remedy is the one performed by writing the successor.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Whether the flag is required is decided by the CLI and met as a refusal; the reason is that the add verb touches only the new record and every effect on the old one is a reader's inference from the pointer, which is a statement about what the command touches rather than a claim the effect is small (A064).
- proposed: Drop the "which is why it never needs `--confirm-shared`" sentences; the ledger holds the reason.

### c3.C032
- key: Rotate anything a deleted record carried, because deletion removes it from the store and not from the git history or the machines that already pulled.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:164
- provenance: 752dbce 2026-08-22, written when the shared tiers gained a delete so that a delete is never read as a redaction; rewritten 2026-10-04 by the finishing pass of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`.
- verdict: rewrite
- reason: The owner of the rotation rule; the trigger section and the project-tier paragraph point at it, and a secret in a synced store recurs (A065 to A067). A delete marks the database row and keeps it, and the record's file stays on every machine's disk beside the git history, so the passage names all three places the content survives.
- passage: **Deletion marks a record's row deleted and erases nothing.** The row stays in the memory database with the deleted mark, the record's file stays on every machine's disk, and the shared tiers' git history keeps its content on every machine that already pulled. Rotate anything it carried that it should not have, since the delete is not a redaction.

### c3.C033
- key: Expect seventeen shapes to get no grant on the unattended vector: `delete-type`, `delete-operator`, `forget`, `--update` with a body, `--body-file`, `--type=<type>`, `--trigger` on either add verb, `--supersedes`, `find`, `--rollup`, `anchor`, `triggers`, `--drop-malformed`, `db-sync`, `db-promote`, `db-curate` and `jev-calibration`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:216, "Seventeen shapes get no grant there"
- provenance: 752dbce 2026-08-22 made the grant hook the enforcement point with six shapes; b5c0a98, c0a1388, 0d1e610, 2b6e936 and 9b1180b 2026-09-03 grew the list to twelve, each addition a reviewer-found reach; the persona-memory-port plan's section 5 added `forget`, the project-tier delete, and its section 6 named the four database verbs the hook already withheld, which the paragraph had left out, so the count reads seventeen as `docs/security-model.md` counts it.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The list stays because a withheld shape on that vector is silence rather than a refusal, so the list is what a worker can consult; the per-shape reasons move here, since hooks/memq-grant.js:43-73 and 501-651 carry every one of them and test/memq-grant.test.js pins each shape (A068 to A070).
- proposed: (via A068) Compress the paragraph to the twelve withheld shapes, the granted rest, the silence rule and the recognition-debt and pointer handoffs, pointing at `hooks/memq-grant.js` for each shape's reason.
- baseline-test: yes
- passage: Under the engine store signals memq runs under the prompt-free grant in `hooks/memq-grant.js`, which owns the list of withheld shapes.
- flag: stale

### c3.C034
- key: Use only the granted rest on that vector: `recall`, `judged`, `get`, `log`, `touch`, `recent`, `unstamped`, `put`, both shared-tier write verbs, `decay-scan`, `decay-done`, the description-only `--update`, and `decay-prune` with its archive flags and their `--confirm-shared`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:218, "What stays granted is the rest"
- provenance: 752dbce 2026-08-22, the grant's allowlist stated in prose; `GRANTED_VERBS` in hooks/memq-grant.js is the list itself; the persona-memory-port plan added `judged` and `put` (D003, D004).
- verdict: retire
- reason: row 893 (Unattended vector grant subset) shrink. The granted set is `GRANTED_VERBS` in `hooks/memq-grant.js`, and the landed sentence naming the hook as the list's owner carries the act.
- passage: What stays granted is the rest: `recall`, `judged`, `get`, `log`, `touch`, `recent`, `unstamped`, `put`, both shared-tier write verbs, `decay-scan`, `decay-done`, the description-only `--update`, and `decay-prune` with its archive flags and the `--confirm-shared` they require, archiving being demotion rather than removal.

### c3.C035
- key: Treat a withheld grant as silence rather than a deny, so the command is lost outright with nobody there to approve it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 752dbce 2026-08-22, the grant hook's design: it emits an allow for one shape and never a deny.
- verdict: keep
- reason: A reading rule the hook cannot print, and the gate it describes is blast-radius (deletes, body replacements, recognition rewrites on a synced store), not loop maintenance (A074, A075).
- passage: A withheld shape is not denied but silent, and with nobody there to approve it the command is lost.

### c3.C036
- key: Leave a fleet-written record's recognition debt to an attended session, since the add lands without `--trigger`, names the missing declaration on stderr, and only the withheld `triggers` verb can merge one in later.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 2b6e936 2026-09-02, when the `--trigger` option was refused on the unattended vector after its own spec's claim that it widened nothing was disproved.
- verdict: keep
- reason: The handoff to an attended session is a human act no program performs, guarding a recognition line that reaches every project and machine (A076 to A079).
- passage: So a fleet worker leaves a withheld shape to an attended session, such as `find`, `--type=<type>`, a delete, a body-carrying update, `--body-file`, `--supersedes`, `--trigger`, `triggers`, `anchor` or `--rollup`.

### c3.C037
- key: Re-run the whole `add` from an attended session to give a record a `supersedes:` pointer, or delete and rewrite one that already landed without it, since the field is creation-only and `--update` refuses it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: b5c0a98 2026-08-23, the supersedes flag withheld from the grant and refused on `--update` (test/memq.test.js:20848).
- verdict: retire
- landed: d2c43f1 section 22
- reason: merged into c3.C036's landed sentence (the withheld `--supersedes` goes to an attended session) and c3.C016's landed sentence (a pointer change is a delete and a fresh write).
- proposed: Recovering a withheld `--supersedes` pointer is not a later flag, because the field is creation-only and `--update` refuses it: the pointer has to ride the creating command, so an attended session re-runs the whole `add`, and a record that already landed without one needs a delete and a fresh write.
- passage: A withheld `--supersedes` pointer cannot be added later, because the field is creation-only and `--update` refuses it. An attended session re-runs the whole `add`, and a record that already landed without one needs a delete and a fresh write.

### c3.C038
- key: Treat `--supersedes` as the one demotion a pin does not stop, so a worker reading `decay-scan`'s pinned names could demote exactly the records the operator marked untouchable.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: b5c0a98 2026-08-23, the reason `--supersedes` is screened by the grant: the archive flags refuse a pinned name outright and a pointer does not.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The withhold list names the shape; this reasoning is carried verbatim by hooks/memq-grant.js:569-586 and lives here for the prose (A084).
- proposed: Move to the ledger; the paragraph points at the hook for reasons.
- baseline-test: yes

### c3.C039
- key: Treat `anchor` and `triggers` as rewrites that could report an unread memory as verified or aim, crowd or erase a record's recognition with nothing on any surface saying it changed.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: c0a1388 2026-08-26 named anchor as withheld at the allowlist alone; 0d1e610 2026-08-30 withheld triggers deliberately; 9b1180b 2026-09-03 priced the `--replace` erasure.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Both verbs are listed as withheld; what a worker could do with them is the reason, carried by hooks/memq-grant.js:513-527 and the security model (A085).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C040
- key: Expect bare `--type` to resolve the project's own declaration and nothing else, while the attached `--type=<type>` spelling that names a foreign tier is withheld.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 9b1180b 2026-09-03, when the named spelling was added for reach and then withheld on the unattended vector because it widened what a worker could read and stamp.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Rows 23 and 27 state both spellings and the refusal at the CLI and the grant alike; the hook (memq-grant.js:643-651, test 505) and memq (memq.js:7620, 9612) enforce it; the entry stays in the twelve, the explanation goes (A086 to A088).
- proposed: (via A086) Keep `--type=<type>` as an entry in the twelve; drop the explanation.

### c3.C041
- key: Treat `--drop-malformed`'s screen as the only thing withholding a prompt-free delete of malformed usage lines, since its coupling to the withheld `--rollup` sits in another file and is not a lock.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: ad7b109 2026-08-25 gave a torn sidecar line its exit; the grant screens the flag on its own (test/memq-grant.test.js:387).
- verdict: retire
- landed: d2c43f1 section 22
- reason: A test pins that the flag gets no grant of its own, and the hook's comment states the coupling; a session has no act to take on the coupling's fragility (A089).
- proposed: Keep `--drop-malformed` in the twelve; drop the coupling sentence.

### c3.C042
- key: Write a project-tier `supersedes:` line by hand with the Write tool, exactly as you write that file's `tags:` and `pinned:` lines.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:170
- provenance: b5c0a98 2026-08-23, the supersedes plan's section on the project tier, which authors the field by hand.
- verdict: retire
- landed: f92e99ec section 5
- reason: No program writes a project-tier pointer; the hand path is the only one (A090). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: The project tier gets it by hand: a project memory is an ordinary file you write with the Write tool, so its `supersedes:` line is authored like its `tags:` and `pinned:` lines.

### c3.C043
- key: Write `supersedes:` at the top level inside the frontmatter block, which must open on the file's first line, and read it there or under the `metadata:` map.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:174
- provenance: b5c0a98 2026-08-23 wrote the grammar; eecf17c 2026-08-23 added the `metadata:` placement when memq learned to read fields where the harness moves them; 426bf68 2026-08-26 put the guard at the write door.
- verdict: retire
- landed: f92e99ec section 5
- reason: Line 116 owns placement for every memq field and the guard enforces placement and the first-line fence on a Write or Edit; the bullet becomes a pointer keeping only the silent-failure note for a file the guard never saw (A091 to A093). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: (via A091) Replace the placement bullet with a pointer at line 116 and the guard section, keeping only the silent-failure note for a file the guard never saw.
- baseline-test: yes
- passage: Written where every memq field is written, per the placement rule above, which `hooks/memory-frontmatter-guard.js` checks on a Write, an Edit or a MultiEdit. In a file the guard never saw, a `supersedes:` under any other key is not the field, and it fails silently.

### c3.C044
- key: Give `supersedes:` one name matching the record-name charset and naming a live record.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:175
- provenance: b5c0a98 2026-08-23, the hand-written field's grammar.
- verdict: keep
- reason: The guard checks the live-record half on the harness path, but a synced or externally edited file gets no check and the author composes to this (A094).
- passage: One name, matching the record-name charset, naming a live record of the same tier. Two names point nowhere.

### c3.C045
- key: Point `supersedes:` only within the same tier: a project memory names a project memory.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:176
- provenance: b5c0a98 2026-08-23, the no-cross-tier bound of the first version.
- verdict: keep
- reason: Nothing validates the tier of a hand-written pointer off the harness path; row 30's same-tier clause is the CLI flag's bound and the pointer side (A096 to A097).
- passage: Same tier only: a project memory names a project memory. There is no cross-tier pointer.

### c3.C046
- key: Treat a hand-written pointer as the one place a dangling pointer can be minted and one of two places a cycle can be, since it gets none of the CLI's six refusals.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:178
- provenance: b5c0a98 2026-08-23 wrote it as "nothing checking it"; 426bf68 2026-08-26 re-qualified it after the guard began checking a pointer on Write, Edit and MultiEdit.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Already falsified once by machinery and patched; the reason the read surfaces survive a bad pointer is the code's concern, and the grammar bullets state what to write (A098).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C047
- key: Write `anchors:` as one line of comma-separated `<path>@<sha>` entries, each path repo-relative and forward-slashed and each sha 40 lowercase hex of the file's git blob name.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:182
- provenance: 426bf68 2026-08-26, the anchors section's definition of the field (docs/archive/claude-kit_memory-anchors-and-frontmatter-guard_spec_v1.md).
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The line shape is the field's definition, which line 116's placement rule does not carry; only the placement clause duplicates it and already reads as a pointer (A099 to A101). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: It is a list of `<path>@<sha>` entries, each path repo-relative.

### c3.C048
- key: Write the anchors line with `memq anchor <name> <path>...`, never by hand.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30 made it the section's bold lead; 426bf68 2026-08-26 installed the section.
- verdict: keep
- reason: The section owns the rule; row 28's "computes the hashes itself" is the pointer side, and the guard refuses a hand-typed entry outside the grammar but cannot check a hash's truth (A102 to A104).
- passage: **Write it with `memq anchor <name> <path>...`, never by hand.**

### c3.C049
- key: Treat a 40-hex value as the one field a hand cannot check, which is why the verb hashes each named file out of the tree and splices one line in, leaving every other byte untouched.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30, the reason beside the bold lead.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The rule is obeyable without it; a hand cannot verify a blob hash, so the verb computes it, which is why by-hand is barred (A105).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C050
- key: Anchor on the project tier only, a run's own pending tier ahead of it; `--type` and `--operator` are refused.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30 restated row 28's tier restriction in the section; the refusal is the verb's (test/memq.test.js:21546).
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 28 states the restriction, the pending precedence and the reason near verbatim, and the verb refuses with the cause named (A107 to A108). Lands with no prose copy of the anchor verb's tier restriction: c1.C054 retired row 28's and this entry retired line 184's, the verb's refusal names the cause, and the correction paragraph's 'The mechanics are the project tier's own, none of the shared-tier verbs reaching it' carries the fact. The key's `--operator` half holds only for an operator record whose `machine:` does not name this host; c1.C054's reason states the admission and where the section carries it.
- proposed: Drop the tier sentence from line 184; row 28 carries it.

### c3.C051
- key: Expect the anchor write to merge rather than replace: an existing path keeps its position and takes the fresh hash, a new path is appended, and unnamed paths keep their old hashes.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30, the merge semantics stated in the section; row 28 states them and test/memq.test.js:21249 pins them.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The merge is the verb's and row 28 carries it; the one consequence a session acts on (a carried entry is not re-verified) is c3.C052's reading rule, which keeps (A109 to A111).
- proposed: (via A109) Drop the merge sentence from line 184; row 28 and C052 carry what a session needs.

### c3.C052
- key: Read the line from stdout and stderr's naming of which paths this run hashed and which were carried over, since a carried entry says nothing about whether that file still holds those bytes.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30, the reporting split written so a carried entry is not read as verified.
- verdict: retire
- reason: row 895 (anchors: field and writing) shrink. The verb prints what it hashed and carried, and the landed rule "Write it with `memq anchor <name> <path>...`, never by hand." carries the act.
- passage: The line goes to stdout, and stderr names which paths this run hashed and which it carried over. A carried entry says nothing about whether that file still holds those bytes.

### c3.C053
- key: Expect the anchor rewrite to leave one generation of the record's previous text in `<name>.md.bak`, swept by no listing and carried by no sync.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30, stated as the shared property of the three verbs that spend a record's one backup generation (`anchor`, `triggers`, the repair).
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 895 (anchors: field and writing) shrink. The backup-generation detail is CLI implementation, and c3.C091's landed `forget` sentence carries the removal act.
- proposed: It leaves one generation of the record's previous text in a `<name>.md.bak` beside it, swept by no listing (`.md.bak` is outside the memory-filename grammar) and carried by no sync, which makes `anchor` one of the three verbs in this CLI that spend a record's one backup generation, `triggers` being the third and taking it on the same record.
- passage: The rewrite leaves one generation of the record's previous text in a `<name>.md.bak` beside it, swept by no listing and carried by no sync. `anchor` is one of the three verbs in this CLI that spend a record's one backup generation, and `triggers` spends it on the same record.
- flag: stale

### c3.C054
- key: Expect anchoring to move the record's mtime and return it to zero idle days on the decay clock.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30, which also stopped a redundant call from moving the mtime the decay pass reads as an idle clock.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The clock reset is a side effect of the write, and c3.C083 states it where a session meets it; the "earned rather than incidental" defence is that anchoring is a verification act, so a just-checked record is a record in use (A116 to A118).
- proposed: (via A116) Drop the mtime sentence from line 184; C083 carries the consequence.

### c3.C055
- key: Expect every anchor refusal to leave the record byte for byte as it was.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26, the anchors section's opening of its refusal paragraph.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 895 (anchors: field and writing) shrink. Each refusal states its own effect, so the act is carried by "Write it with `memq anchor <name> <path>...`, never by hand.".
- proposed: Every refusal leaves the record byte for byte as it was.
- passage: Every refusal leaves the record byte for byte as it was.

### c3.C056
- key: Expect a refusal for a name outside the memory-filename grammar, a name no project or pending record holds, or a pending entry that could not be examined.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26, the refusal class; the pending-tier examination case is pinned by test/memq.test.js:2187 and 22193.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 28 states the class and the verb refuses by name; the section's copy is the third statement (A122 to A124). Lands with row 28's refusal list retired under c1.C055, so no copy of this class remains; the refusal names itself, and the passage keeps the two costly bars, the named-together bound and c3.C061's reading rule. Its landing respelled c3.C055's keep sentence; c3.C055 records the flip.
- proposed: (via A122) Drop the class from line 186; row 28 carries it and the refusal names itself.

### c3.C057
- key: Expect a refusal when the root resolves to nothing: under a store pin, or where a derived root is not a resolvable directory.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26; the pin cause was corrected by da9c3d7 2026-08-27 (test/memq.test.js:21620, 21656).
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 28 names both shapes and the verb refuses with the cause (A125 to A127). Lands as c3.C056 records: row 28's copy is retired under c1.C055 and the refusal names the cause.
- proposed: (via A125) Drop the class from line 186.

### c3.C058
- key: Keep anchor paths inside the grammar, which refuses whitespace, win32 reserved device stems on every platform, absolute paths, `..` segments, backslashes, colons, a second `@`, commas, quotes, wildcards, dots-only or trailing-dot segments, and a leading YAML indicator.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26 wrote the grammar; 0d1e610 2026-08-30 closed the YAML-indicator injection; test/memq.test.js:22044 and 22085 pin the bars.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 895 (anchors: field and writing) shrink. Each refusal names its entry and rule, which the judge's reason relies on.
- proposed: (via A128) Keep the two costly bars and the every-refused-path-named-together bound; replace the enumeration with "the refusal names the entry and the rule it met".
- baseline-test: yes
- passage: A path outside the anchor grammar is refused, with every refused path named together. Two of the grammar's bars cost real files. Any whitespace is refused, so `docs/my notes.md` cannot be anchored. A win32 reserved device stem such as `COM1` is refused on every platform.

### c3.C059
- key: Expect a refusal for a record no reader can read: unclosed frontmatter within the reader's line bound, an `anchors:` key under something other than `metadata:`, or bytes that are not valid UTF-8.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26, the readability refusal, which the guard also applies at the write door.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 28 names the class, the verb refuses by cause and the guard refuses the same shapes on a Write (A131 to A133). Lands as c3.C056 records: row 28's copy is retired under c1.C055, and the verb and the guard refuse by cause.
- proposed: (via A131) Drop the class from line 186.

### c3.C060
- key: Expect a refusal for a line the merge cannot preserve whole: one carrying an entry the reader refuses, one longer than a reader reads, or a merge pushing the record past 32 entries.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26; the reader's entry cap was stated by ad7b109 and 5ac33f5 2026-08-25.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 28 names the class and the verb refuses by name (test/memq.test.js:2244) (A134 to A136). Lands as c3.C056 records: row 28's copy is retired under c1.C055 and the verb refuses by name.
- proposed: (via A134) Drop the class from line 186.

### c3.C061
- key: Read what a refusal tells you rather than holding the list in your head, since each names the entry and the rule it met.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26, the sentence that licenses the enumerations around it to retire.
- verdict: retire
- reason: row 895 (anchors: field and writing) shrink. The refusal names the entry and the rule it met, so nothing needs memorizing.
- passage: For the rest, read the refusal: each names the entry and the rule it met.

### c3.C062
- key: Read drift from four surfaces, three of which say on each record's own line that they could not check rather than answering as if they had.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:188
- provenance: 426bf68 2026-08-26 wrote the map; da9c3d7 2026-08-27 corrected the surface account across three surfaces after a Critical found a cause the code never emits.
- verdict: retire
- reason: row 896 (Drift reporting surface catalogue) shrink. The act is carried by the landed paragraph "`memq decay-scan`, `memq get` and `memq recall` report drift ... run `memq decay-scan` when you need the answer.".
- passage: Four surfaces report what the field says about the tree. The three that print per record say on the record's own line when they could not check, so no line reads as verified by silence.

### c3.C063
- key: Do not read drift from `find` or from the frontmatter guard: `find` carries no anchor label on either channel, and the guard judges a record being written.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:188
- provenance: 426bf68 2026-08-26, the two non-surfaces named so a reader does not look for a label `find` never prints.
- verdict: retire
- reason: row 896 (Drift reporting surface catalogue) shrink. The landed paragraph names only the surfaces that report drift.
- passage: `find` carries no anchor label, so a hit there says nothing about drift.
- passage: The frontmatter guard judges a record at the write door rather than reporting on one, per its section below.

### c3.C064
- key: Read `memq decay-scan`'s drift block on stderr after its other blocks and before the neighbour-pairs block, headed by tier and counting each class, with `memq: drift <name> changed:/missing:/unreadable:` rows and `not checked (<why>)` rows.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:190
- provenance: 426bf68 2026-08-26 wrote the surface's bullet; 91111b3 2026-09-05 placed it ahead of the neighbour-pairs block; test/memq.test.js:2899, 2988, 4417 pin the rows and causes.
- verdict: retire
- reason: row 896 (Drift reporting surface catalogue) shrink. `decay-scan` prints its own rows and causes.
- passage: `memq decay-scan` prints the drift block on stderr after its other blocks and ahead of the neighbour-pairs block, headed by the tier it covers. It gives a `changed:`, `missing:` or `unreadable:` row per drifted live record, pinned ones included, and a `not checked (<why>)` row per record it could not check.

### c3.C065
- key: Read `memq: no anchor drift (project tier)` as a pass that checked everything, and expect a heading cause only for an unexaminable tier or a store pin leaving no root.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:190
- provenance: 426bf68 2026-08-26 reserved the clean line; c0a1388 2026-08-26 and da9c3d7 2026-08-27 installed and corrected the network-share account.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 896 (Drift reporting surface catalogue) shrink. The heading causes are the scan's own output, and the network-share stand-down belongs to the resolver paragraph at the top of the skill.
- proposed: (via A145) Keep the reserved-line rule and the two heading causes; replace the share sentences with one pointer at the stand-down rule.
- baseline-test: yes
- passage: `memq: no anchor drift (project tier)` is reserved for a pass that checked everything and found nothing. The heading carries a cause instead in exactly two states: a tier that is there and could not be examined, and a store pin leaving no root. A network share is the resolver's stand-down at the top of this skill, never a heading cause.

### c3.C066
- key: Read `memq get`'s per-anchor lines after the record text: `<path> fresh`, `changed (recorded <sha7>, now <sha7>)`, `missing`, or `unreadable`, plus a cut-parse row naming the entries not checked.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:191
- provenance: da9c3d7 2026-08-27, the surface's bullet after the finishing pass corrected its cause account; test/memq.test.js:3011 pins the lines.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 23 states that `get` follows the body with one line per anchor or one naming why; the shapes are self-describing output the verb prints (A148 to A150).
- proposed: (via A148) Drop the per-anchor shapes from line 191, keeping the surface's one-line entry in the map.

### c3.C067
- key: Read `get`'s single `not checked (<cause>)` line as naming unreadable frontmatter, an unexaminable project root, or a store pin leaving no root.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:191
- provenance: da9c3d7 2026-08-27, which replaced a network cause the code never emits with the two-cell property the code has.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The cause line names itself, and enumerating its spellings in prose is where the wrong cause once stood; the share clauses point at the stand-down rule (A151).
- proposed: Drop the cause enumeration and the share sentences from line 191.

### c3.C068
- key: Read `memq recall`'s `[drift]` token on a drifted live project-tier record and `[drift?]` on one it could not verify, both before the description, so an unlabeled line is never an unchecked one.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:192
- provenance: da9c3d7 2026-08-27; test/memq.test.js:3217 and 3264 pin the tokens.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The digest writes the tokens, but "an unlabeled line is never a line nobody checked" is the session's reading rule and nothing prints it (A152). Flipped from keep to rewrite at section 22's close: c3.C116's retire dropped the slot clause, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: marks the digest line of a drifted live project-tier record with a `[drift]` token, and marks one the pass could not verify with `[drift?]`, so an unlabeled line is never a line nobody checked.
- passage: `recall` with a `[drift]` token on a drifted record and `[drift?]` on one it could not verify

### c3.C069
- key: Read the pending tier's coverage line twice, since it is the other tier `memq anchor` writes to and most likely to hold anchored records this digest never checked.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:192
- provenance: da9c3d7 2026-08-27, from the whole-file read that found `get` and `anchor` resolve a run's pending tier ahead of the project tier.
- verdict: retire
- reason: row 896 (Drift reporting surface catalogue) shrink. The coverage line states its own per-tier clauses.
- passage: Read the pending tier's twice: it is the other tier `memq anchor` writes to, so it is the likeliest to hold anchored records this digest never checked.

### c3.C070
- key: Read the SessionStart hook's last line as up to three sentences: how many project memories anchor a changed file, how many could not be checked, and how many the check stopped short of at its bound of 200 records, 500 anchors or 8388608 bytes.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:193
- provenance: c98af86 2026-08-28; test/memory-session.test.js:2701, 2938 pin the line and its bound.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: A session must know the line's shape before it can read its silence (c3.C071); the numeric bounds ride the line itself and are the one part a rewrite may drop (A154). Flipped from keep to rewrite at section 22's close: c3.C118's retire dropped the run-scoped clause, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The SessionStart hook prints one line last in what it emits.
- passage: The SessionStart hook's last line counts it.

### c3.C071
- key: Read the session line's silence as no claim that anything was checked, since five causes produce it: all counts zero, a store pin, moved memq exports, a session begun from `clear`, and an unpinned network share standing the whole hook down.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:193
- provenance: 426bf68 2026-08-26 named the `clear` silence ("a store full of drift looks exactly like a clean one"); c0a1388 2026-08-26 and c98af86 2026-08-28 added the network cause.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The doctrine's silent-check principle is the general rule; this is the instance with its five causes, each installed by its own incident, which no other surface carries (A155 to A157). Flipped from keep to rewrite at section 22's close: c3.C119's retire dropped the synchronous-walk clause, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The fifth is outside it too, and it is not the drift line alone: an unpinned working directory that names a network share stands the whole hook down before the check would ever run, so the session line's silence there is one symptom of a stand-down that also silences the decay nudge, the type index, and the destination line.
- passage: A quiet session start is no proof of a clean check, so run `memq decay-scan` when you need the answer.

### c3.C072
- key: Run `memq decay-scan` when you need the drift answer rather than reading a quiet session start as a checked one.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:193
- provenance: 426bf68 2026-08-26, the remedy for a quiet session start; c98af86 2026-08-28 bounded it with c3.C073.
- verdict: keep
- reason: c3.C073 is its carve-out for the one state the remedy fails in, so the two are intentionally different semantics, not a contention (A158, A159).
- passage: A quiet session start is no proof of a clean check, so run `memq decay-scan` when you need the answer.

### c3.C073
- key: Move off the network share or pin the store to get the answer there, never re-run the verb, since `decay-scan` itself stands down on an unpinned network working directory.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:193
- provenance: c98af86 2026-08-28, the finishing pass that found the paragraph's remedy was itself one of the eleven verbs that stands down in exactly that state.
- verdict: retire
- reason: row 896 (Drift reporting surface catalogue) shrink. The network-share stand-down and its remedy belong to the resolver's refusal paragraph at the top of the skill.
- passage: Under the fifth cause `decay-scan` stands down too, so move off the share or pin the store rather than re-running it.
- flag: weak-reason

### c3.C074
- key: Expect no Unicode normalization of anchor paths, so a name spelled NFD on one filesystem and NFC on another reads `missing` on Linux.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:195
- provenance: 426bf68 2026-08-26, the three stated limits of the first version.
- verdict: retire
- reason: row 898 (Anchor trust limits), dropped under the mechanism cut.
- passage: Nothing normalizes Unicode, so a name spelled NFD on one filesystem and NFC on another differs in bytes, and on Linux an anchor written under the other form reads `missing`.
- ruled: cut 2026-09-30

### c3.C075
- key: Treat an admitted path as one none of the named invisible-character classes was found in, never one proved to draw everything it carries.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:195
- provenance: 426bf68 2026-08-26; test/memq.test.js:22044 pins the named classes.
- verdict: retire
- reason: row 898 (Anchor trust limits), dropped under the mechanism cut.
- passage: So an admitted path is one in which none of those classes was found, never one proved to draw everything it carries, and homoglyph confusion stays a residual.
- flag: weak-reason
- ruled: cut 2026-09-30

### c3.C076
- key: Treat the anchor hash as the SHA-1 git blob name over the file's on-disk bytes with no decode: change detection, not tamper evidence.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:195
- provenance: 426bf68 2026-08-26, the third stated limit.
- verdict: retire
- reason: row 898 (Anchor trust limits), dropped under the mechanism cut.
- passage: The hash is the git blob name, SHA-1 over the on-disk bytes with no decode, so it detects change and is no tamper evidence. A checkout holding the other line ending reads `changed` on every text file a record anchors.
- ruled: cut 2026-09-30

### c3.C077
- key: Re-anchor from the main checkout once the merge has landed there, since anchor paths resolve against the project's main root and are no check on a worktree's own edits.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:197
- provenance: 426bf68 2026-08-26, the worktree pairing: records come from the main checkout's store and hash the main checkout's files.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule and its one-clause reason stay; the defence of the pairing as coherent rather than an oversight (one record hashing a different tree per worktree would report drift about which directory a session opened in) lives here (A163).
- proposed: Keep the rule with its one-clause reason; move the coherent-pairing defence to the ledger.
- baseline-test: yes
- passage: In a linked worktree, anchors hash the main checkout's files and are no check on the worktree's own edits, so re-anchor from the main checkout once the merge has landed.

### c3.C078
- key: Read a drift line as the memory being unverified rather than wrong, since any byte counts and no surface has read the record's prose or the file's.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:199
- provenance: 426bf68 2026-08-26, the reading rule the drift procedure rests on.
- verdict: keep
- reason: The surfaces report bytes and draw no conclusion (A164).
- passage: **A drift line means the memory is unverified, not wrong.** A file the record names holds different bytes than when the record was written, and no surface has read the record's prose or the file's.

### c3.C079
- key: Settle the drift line naming a memory you are about to rely on, and sweep the rest at the Chapter boundary where `memq unstamped` already runs.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:199
- provenance: 426bf68 2026-08-26, written so a drift line is not read as a stop.
- verdict: keep
- reason: Nothing blocks on a drift line, so when to settle one is the session's rule (A165).
- passage: Settle the one naming a memory you are about to rely on, and sweep the rest at the Chapter boundary where `memq unstamped` already runs.

### c3.C080
- key: Re-read the anchored source file first, then the record against it, before deciding which remedy the record earns.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 426bf68 2026-08-26, after a blind reader handed only the shipped drift line found the remedies unperformable twice over; 0d1e610 2026-08-30 last reworded the paragraph.
- verdict: keep
- reason: The procedure for one finding class, owned by the four-remedies section; the doctrine's finding-is-a-hypothesis rule is the principle and not a copy of it (A166 to A169).
- passage: Re-read the anchored file first, then the record against it, then route the record through the four remedies above.

### c3.C081
- key: Read the record itself with the Read tool whenever a rewrite comes next, since that hands back the exact bytes where `get`'s cap can cut a long record.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 0d1e610 2026-08-30, closing the blind reader's second finding that no surface hands a reader the anchors line to carry across a rewrite.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: Line 38 bars copying out of `get`; this names the tool to use instead, and both are needed (A170, A171). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: To correct a project record, read it with `memq get` and write it again with `memq put --replace`, passing its tags again, since a replace clears every list it does not name.

### c3.C082
- key: Do the same read on a `not checked` line and fix what its cause names: the record's frontmatter block, the project's root, or the record's file.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 0d1e610 2026-08-30, the not-checked branch of the drift procedure.
- verdict: retire
- reason: row 899 (Settling a drift line) shrink. A `not checked` line names its own cause, and c3.C081's landed sentence carries the read-then-rewrite act.
- passage: A `not checked` line needs the same read, because it carries a cause and never a path, so the record's own `anchors:` line is the only place its paths remain. Fix what the cause names: the frontmatter block, the project's root, or the record's file.

### c3.C083
- key: Re-anchor by running `memq anchor` over the same paths again, which restarts the record's idle clock.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 0d1e610 2026-08-30, the re-anchor remedy for a record whose fact still holds.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: Distinct from c3.C087, which is the re-anchor after a correction; the idle-clock consequence lives here now that c3.C054 retires (A172, A173). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Then re-run `memq anchor` and `memq triggers`.

### c3.C084
- key: Correct a record by rewriting its file with the Write tool and carrying its whole frontmatter block across: `anchors:`, `tags:`, `created:`, `pinned:`, `machine:`, `supersedes:` and `triggers:`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 0d1e610 2026-08-30, which added `triggers:` to the carried set; 426bf68 2026-08-26 installed the carry-across rule.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The paragraph binds the mechanics to the project tier, so it never meets the operator tier's Write bar; each dropped field loses its effect silently and nothing detects the drop (A174). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: To correct a project record, read it with `memq get` and write it again with `memq put --replace`, passing its tags again, since a replace clears every list it does not name.

### c3.C085
- key: Expect a rewrite that drops the `anchors:` line to silence the drift instead of settling it, since a Write replaces the file.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 426bf68 2026-08-26, the warning beside the carry-across rule.
- verdict: retire
- landed: d2c43f1 section 22
- reason: merged into c3.C084's landed sentence ("since a dropped field loses its effect silently"), which covers a dropped `anchors:` line.
- proposed: A Write replaces the file, so a rewrite that drops the `anchors:` line silences the drift instead of settling it, and a record that anchors nothing is reported by no surface, so the drift goes quiet.
- passage: A Write replaces the file, so a rewrite that drops the `anchors:` line silences the drift instead of settling it, and a record that anchors nothing is reported by no surface, so the drift goes quiet.

### c3.C086
- key: Expect a record that anchors nothing to be reported by none of the four surfaces: no `get` line, no `recall` token, skipped by the scan, and passed over by every session-line count.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 0d1e610 2026-08-30; test/memq.test.js:3061 pins the silence.
- verdict: retire
- landed: d2c43f1 section 22
- reason: All four omissions are code; the one use a session has for the fact is c3.C085's warning, which keeps one clause of it (A176). Its landing respelled c3.C085's keep sentence; c3.C085 records the flip.
- proposed: Fold one clause into C085 ("and a record that anchors nothing is reported by no surface, so the drift goes quiet"); drop the four-surface enumeration.

### c3.C087
- key: Run `memq anchor` over the same paths after correcting the prose, because correcting prose re-hashes nothing and the drift line stands until something does.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 426bf68 2026-08-26, the step the blind reader's first pass found missing.
- verdict: retire
- reason: merged into c3.C083's landed sentence, which states the re-anchor both after a correction and where the record stands.
- passage: Then run `memq anchor` over the same paths again, because correcting the prose re-hashes nothing.
- flag: weak-reason

### c3.C088
- key: Do not treat the `<name>.md.bak` an anchor run leaves as a way back from a bad correction, since it holds the corrected text and nothing keeps what stood before.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 0d1e610 2026-08-30, the trap beside the re-anchor-after-correction step.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The re-anchor rule is obeyable without it; the trap is that the backup is taken by the anchor run and holds the record as that run found it, the corrected text, so nothing anywhere keeps the pre-correction text (A177).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C089
- key: Supersede by writing the replacement into the memory write destination the session hook names, carrying `supersedes: <name>` where the name is the replaced record's filename without `.md`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 0d1e610 2026-08-30 reworded the project-tier supersession step installed by 426bf68 2026-08-26.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: One of the seven procedure steps kept whole under A168; the kaizen note on the supersession second step (2026-09-04, now a `migrated` kaizen issue) applies here as at c3.C024. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: Supersede a shared record with a replacement written with `--supersedes <name>`.

### c3.C090
- key: Retire a record with `decay-prune --archive <name>`, which demotes it to the tier's `archive/` and keeps it answering `get` by name.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:201
- provenance: 0d1e610 2026-08-30, the archive remedy named in the drift procedure.
- verdict: keep
- reason: The remedy list needs the verb; line 38 states reachability as `get`'s note and is not a copy (A178 to A180).
- passage: Retire it with `decay-prune --archive <name>`.

### c3.C091
- key: Remove a project-tier record with `memq forget <name> --confirm`, which takes its `MEMORY.md` index line, its retired copy and archive index line, its usage stamps and any `<name>.md.bak` and `<name>.md.tmp.<pid>` beside it in one locked operation.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:261
- provenance: 0d1e610 2026-08-30, the project tier's hand delete, widened to the two copies a rewrite can leave; respelled by the persona-memory-port plan's section 5, which gave the project tier the `forget` verb.
- verdict: keep
- reason: The remedy list needs the verb and the rotation beside it. `cmdForget` (`scripts/memq.js`) sends one `mem.usp_ArchiveRecord` row with the deleted mark through `writeThrough`, the queue behind it, and removes no file, which is E009's row. The host keeps the marked row, so the record's text outlives the removal and a secret it carried needs rotating. Rewritten on 2026-10-04 by the finishing pass of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, whose reason named a file sweep under the tier lock that `forget` no longer performs; the verdict before it was keep.
- passage: Remove it outright with `memq forget <name> --confirm`, and rotate any secret it carried.
- flag: stale

### c3.C092
- key: Expect the record's read and applied stamps to stay in `usage.jsonl` whatever you do, since no project-tier path drops one record's stamps.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:203
- provenance: 0d1e610 2026-08-30, a consequence of what no project-tier path does.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A session has no act to take on an orphaned stamp; the retention is the code's (A183).
- proposed: Drop the stamps sentence from line 203.

### c3.C093
- key: Sweep the local copies and rotate the secret after a hand unlink, because a project tier syncs under `projects/*/memory` and the record is already in the repository's history and on the private remote.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:205
- provenance: 426bf68 2026-08-26, the project tier's instance of the rotation rule line 164 owns.
- verdict: retire
- landed: d2c43f1 section 22
- reason: merged into c3.C091's landed sentence (forget and rotate). c3.C032's deletion paragraph carries the history reason.
- proposed: Keep the two acts with one clause saying the record's text is already in the store's history, pointing at the deletion paragraph.
- baseline-test: yes
- passage: The record's own text is already in the store's history, per the deletion paragraph above. So where the four remedies route to a delete, run `forget` and rotate the secret.
- flag: stale

### c3.C094
- key: Never delete a memory on a drift line alone.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:207
- provenance: 426bf68 2026-08-26, closing the anchors section on the nomination principle.
- verdict: keep
- reason: A drift line is a nomination and no `decay-prune` flag acts on one; the decay threshold rule at line 270 shares the principle and is not the same instruction (A185, A186).
- passage: Never delete a memory on a drift line alone.

### c3.C095
- key: Expect the session hook to emit the type index at session start, and expect `find`, `get`, `touch --type`, and the decay pass to span both the project and type tiers.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:149
- provenance: 8e22ff4 2026-07-31, the opt-in sentence's second half.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The index emission is what the opt-in buys and stays beside it; the verb enumeration is each row's own and goes (A187). Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: Keep "the session hook then emits the type index at session start"; drop the verb enumeration.
- passage: and session start then lists that type's records from the snapshot

### c3.C096
- key: Know that seven of the twelve unattended-vector withholdings (delete-type, delete-operator, `--update` with a body, `--body-file`, `--type=<type>`, `--trigger` on either add verb, `--supersedes`) are also refused by memq itself, making the grant a second lock only for those seven, and that `triggers --replace`'s erasure carries this same second lock while its aiming does not.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 752dbce 2026-08-22 first counted which shapes carry a second lock; 9b1180b 2026-09-03 reached the seven-of-twelve shape after adding memq's own refusal of a shared-tier or pinned `--replace`.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The two-lock structure is a security-model fact carried by docs/security-model.md:667-673 and the hook's header, pinned in code; on the vector it describes the outcome is silence either way, so a session gains no act from it. c3.C100 and c3.C109 are the same sentence extracted again (A188 to A190).
- proposed: (via A188) Drop the second-lock sentences from line 166; the security model and the hook header carry the account.

### c3.C097
- key: Treat the `supersedes:` grammar as deliberately strict outside its two valid placements, because a hand-typed pointer gets no CLI validation and nothing else checks it on any read path.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:172
- provenance: b5c0a98 2026-08-23 wrote the reason; 426bf68 2026-08-26 re-qualified it when the guard began checking a pointer at the write door.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The grammar bullets state the rules whole and the guard now checks the harness path; the strictness exists because a file the guard never saw (synced, or edited outside the harness) has nothing checking it on any read path (A191 to A193).
- proposed: (via A192) Move to the ledger.
- baseline-test: yes

### c3.C098
- key: Expect read surfaces to survive a bad `supersedes:` pointer: a dangling name labels nothing and is inert, every member of a cycle is dropped regardless of its length while an outside pointer into the cycle still labels the member it names, and no read path ever retires a record just because a pointer says so.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:178
- provenance: b5c0a98 2026-08-23 named the three-ring gap; 0d02214 2026-08-23 closed it; test/memq.test.js:20440, 20463, 20493 pin each case.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The survival is built into the readers and pinned per case (A194).
- proposed: Drop the sentence from line 178.

### c3.C099
- key: Expect a successful `memq anchor` run to say nothing about the `.md.bak` it wrote; the backup's name is printed only on a failed rewrite.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30, the verb's reporting.
- verdict: retire
- landed: d2c43f1 section 22
- reason: What the verb prints on success and on failure is the verb's; c3.C112 is the same clause extracted again (A195 to A197). Its landing respelled c3.C053's keep sentence; c3.C053 records the flip.
- proposed: (via A195) Drop the parenthetical from line 184.

### c3.C100
- key: Know that seven of the twelve withheld shapes are also refused by memq itself, making the grant a second lock only for those seven.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 9b1180b 2026-09-03, the same sentence as c3.C096.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Duplicate extraction of c3.C096, retiring with it (A198).
- proposed: (via A188) Drop the second-lock sentences from line 166; the security model and the hook header carry the account.

### c3.C101
- key: Understand delete-type and delete-operator are withheld because they remove a record every project reading that shared store reads.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 752dbce 2026-08-22, the grant hook's reason for leaving the delete verbs out of the allowlist (hooks/memq-grant.js:43).
- verdict: retire
- landed: d2c43f1 section 22
- reason: The shape is listed; the reason is the hook's own comment and lives here for the prose (A199).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C102
- key: Understand a body-bearing --update is withheld because it replaces the body whole and the only backup is a local .bak the sync never carries.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 752dbce 2026-08-22 (hooks/memq-grant.js:501-502).
- verdict: retire
- landed: d2c43f1 section 22
- reason: As c3.C101 (A200).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C103
- key: Understand --body-file is withheld because it reads a caller-named path into a tier that syncs to a private remote.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 752dbce 2026-08-22 (hooks/memq-grant.js:54, 502-503).
- verdict: retire
- landed: d2c43f1 section 22
- reason: As c3.C101 (A201).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C104
- key: Understand --type=<type> is withheld (while bare --type stays granted) because it would let a worker read and stamp an arbitrary type tier's clocks instead of only the project's declared type, breaking the invariant that a stamp cannot land in a type the project never opted into.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 9b1180b 2026-09-03, when the named spelling widened what a worker could read and stamp on two commands it already had.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The invariant is kept by the grant's spelling test and memq's own refusal; the reasoning is hooks/memq-grant.js:643-651's (A202).
- proposed: (via A086) Keep `--type=<type>` as an entry in the twelve; drop the explanation.

### c3.C105
- key: Understand --trigger on either add verb is withheld because it would write the same triggers: line as the withheld triggers verb, reopening through the front door the reach that verb is withheld for.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 2b6e936 2026-09-02, after the section's spec claimed the option widened nothing and the permission layer disproved it (hooks/memq-grant.js:587-611).
- verdict: retire
- landed: d2c43f1 section 22
- reason: The shape is listed; the front-door argument is the hook's comment at the screen (A203).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C106
- key: Know that withholding --supersedes only drops the pointer field; the record still lands with every other field intact.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: b5c0a98 2026-08-23; test/memq.test.js:20884 pins that the record still lands under memq's own refusal.
- verdict: retire
- landed: d2c43f1 section 22
- reason: memq's behavior under its own refusal, pinned (A204). Its landing respelled c3.C037's keep sentence; c3.C037 records the flip.
- proposed: Drop the sentence from line 166.

### c3.C107
- key: Understand find is withheld at the grant alone because it loads an embedder out of a directory the command line does not name.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 752dbce 2026-08-22 (hooks/memq-grant.js:513).
- verdict: retire
- landed: d2c43f1 section 22
- reason: A reason attached to one entry of a list the hook carries (A205).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C108
- key: Understand --rollup is withheld at the grant alone because it discards the prose of every journal entry it folds.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 752dbce 2026-08-22 (hooks/memq-grant.js:612-632; docs/security-model.md:673).
- verdict: retire
- landed: d2c43f1 section 22
- reason: As c3.C107 (A206).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C109
- key: Know that for triggers --replace specifically, memq itself refuses a replace reaching a shared tier or a pinned project store under fleet signals, giving that one shape (unlike triggers-aiming) a genuine second lock beyond the --confirm-shared flag.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: 9b1180b 2026-09-03, the second lock added when `--replace` turned an authoring command into a destructive one (memq.js:10889).
- verdict: retire
- landed: d2c43f1 section 22
- reason: c3.C096's trailing clause extracted again; row 29 states memq's refusal in its own words (A207 to A209).
- proposed: (via A188) Drop the second-lock sentences from line 166; the security model and the hook header carry the account.

### c3.C110
- key: Understand decay-prune's granted archive flags perform demotion, not removal, which is why they stay granted on the unattended vector.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:166
- provenance: ae2c70a 2026-08-22, when the archive flags' consent was documented; the reasoning is docs/security-model.md:673's.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The granted set is stated; why the archive flags are in it is the hook's and the security model's (A210).
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C111
- key: Understand the supersedes: grammar is strict on purpose because a hand-typed pointer has nothing checking it on any read path other than the frontmatter guard, which only screens the Write/Edit/MultiEdit that lands it.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:172
- provenance: 426bf68 2026-08-26, the re-qualified form of c3.C097's clause.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Duplicate extraction of c3.C097, retiring with it (A211).
- proposed: (via A192) Move to the ledger.
- baseline-test: yes

### c3.C112
- key: Expect the `<name>.md.bak` filename to appear only on a failed rewrite's printed line, never on a successful one.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:184
- provenance: 0d1e610 2026-08-30, the same clause as c3.C099.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Duplicate extraction of c3.C099, retiring with it (A212).
- proposed: (via A195) Drop the parenthetical from line 184.

### c3.C113
- key: Understand that an unexaminable pending entry is refused rather than treated as absent because treating it as absent would silently overwrite a same-named project-tier record and report success.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26, the reason for the pending-tier refusal (test/memq.test.js:2187).
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal retires at A122; its reason, that reading a failed examination as absence would rewrite the shared project-tier record of that name and report success, lives here (A213).
- proposed: Move to the ledger.

### c3.C114
- key: Expect additional anchor refusal causes beyond the five named ones, including a malformed command line, a tier lock held by another writer, a record file that is not a plain regular file, and a rewrite that could not be verified after landing.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26, the closing enumeration of refusals that name themselves.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The passage says these name themselves; the enumeration adds nothing a refusal does not (A214).
- proposed: Drop the closing enumeration from line 186, keeping "the rest refuse the same way and name themselves".

### c3.C115
- key: Treat minting an anchors field that no reader can check as especially undesirable, since the field's whole purpose is to report drift.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:186
- provenance: 426bf68 2026-08-26, the reason for the unreadable-record refusal.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal retires at A131; its reason is that an unclosed block or a misplaced key yields a record every reader answers `not checked` for, the last thing a drift field should be minted as (A215).
- proposed: Move to the ledger.

### c3.C116
- key: Place the `recall` `[drift]`/`[drift?]` token in the same slot the `superseded by` label uses, and beside that label when a record carries both.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:192
- provenance: da9c3d7 2026-08-27; test/memq.test.js:3217 pins both labels at once.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The slot is fixed by the digest and a session reads the token wherever it sits (A216). Its landing respelled c3.C068's keep sentence; c3.C068 records the flip.
- proposed: Drop the slot clause from line 192.

### c3.C117
- key: Read the `recall` coverage line's separate count for records the digest's own listing could not examine, since those records carry no digest line or token.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:192
- provenance: da9c3d7 2026-08-27, the coverage line's separate count.
- verdict: retire
- reason: row 896 (Drift reporting surface catalogue) shrink. The coverage line prints its own count.
- passage: The coverage line also counts the records the digest's listing could not examine, which have no line to carry a token.

### c3.C118
- key: Expect the SessionStart hook to emit no project index block in a run-scoped session, only the drift line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:193
- provenance: c98af86 2026-08-28, the run-scoped clause of the session-line bullet.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The omission is the hook's own behavior and a session there sees what it sees (A218). Its landing respelled c3.C070's keep sentence; c3.C070 records the flip.
- proposed: Drop the run-scoped clause from line 193.

### c3.C119
- key: Understand that the SessionStart hook stands down on an unpinned network share because a synchronous walk there risks the same hang the drift check itself refuses to run into.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:193
- provenance: c0a1388 2026-08-26, the incident: a synchronous stat under an unreachable share blocked for the SMB timeout, and a hook that runs long loses its whole stdout, the project index and the write destination with it.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The stand-down is stated as a fact of the hook; the hang account is the reason and lives here (A219). Its landing respelled c3.C071's keep sentence; c3.C071 records the flip.
- proposed: Move to the ledger.
- baseline-test: yes

### c3.C120
- key: Expect the decay pass to sweep a record's `.bak` and `.tmp.<pid>` copies when it retires that record.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:203
- provenance: 0d1e610 2026-08-30 stated the sweep beside the hand move; 752dbce 2026-08-22 gave the reason, a `.bak` beside a tier keeps a retired memory readable in a file no reader lists.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The sweep is the decay pass's own (A220).
- proposed: Drop the "which is why the decay pass sweeps" clause from line 203.

### c4.C001
- key: Write the `triggers:` field as one line of comma-separated `<type>:<pattern>` entries naming the deterministic signals a record should be recognized by.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:211
- provenance: 0d1e610 2026-08-30, Section 1 of the memory-recognition plan installed the field as a sibling of `anchors:`.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The CLI produces the line but nothing else teaches its shape, and line 201 tells a session rewriting a record to carry the line across whole, so the example is load-bearing. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: It is a list of `<type>:<pattern>` entries, such as `cmd:git stash`, `err:module not found` and `glob:plugins/grimoire/hooks/*.js`.

### c4.C002
- key: Write `triggers:` at the top level of the frontmatter block, and read it either there or under the `metadata:` map the harness moves it to.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:211
- provenance: 0d1e610 2026-08-30, installed with the field in the anchors idiom; the two-placement rule itself is the frontmatter rule at line 116 (eecf17c 2026-08-23, memq reads its fields where the harness puts them).
- verdict: retire
- landed: f92e99ec section 5
- reason: Line 116 owns the placement rule for every field; the triggers copy already points there ("same two placements as `tags:` and `anchors:`") and the restatement after the pointer is the duplicate that leaves. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: (via A002) Keep "same line discipline and the same two placements as `tags:` and `anchors:`" and drop the clause from "written at the top level" to "moves it to".
- passage: Line discipline and placement follow `tags:`.

### c4.C003
- key: Treat `triggers:` as a sibling of `anchors:` rather than an extension of it, because a pattern has no bytes to hash and nothing to drift.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:211
- provenance: 0d1e610 2026-08-30, the commit body describes the field as "sibling to `anchors:`".
- verdict: retire
- landed: d2c43f1 section 22
- reason: Design background that nothing in the section needs in order to be obeyed; the consequences it explains (no drift column on `decay-scan`, re-declaring verifies nothing) are each stated where they apply. The reason lives here: a trigger is a pattern with no bytes behind it, so it cannot drift, cannot be verified, and gives the decay pass nothing to report.
- proposed: Delete the sentence from "It is the sibling" to "nothing to drift"; the ledger entry for C003 holds the reason.

### c4.C004
- key: Use only six trigger types: `cmd:` against a Bash command, `err:` against failed output, `skill:`, `agent:`, `tool:`, and `glob:` against a path.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:213
- provenance: 0d1e610 2026-08-30, the six types installed with the field (cmd, err, skill, agent, tool, glob).
- verdict: keep
- reason: memq refuses a seventh type (TRIGGER_TYPES at scripts/memq.js:467) but its refusal names the types and not their subjects; what each type is matched against is knowledge only this sentence carries, and an author cannot choose a type without it.
- passage: Six types, and the type is what says how the pattern is read: `cmd:<pattern>` against a Bash command, `err:<pattern>` against a failed call's output, `skill:<name>` for a skill invocation, `agent:<type>` for an agent dispatch, `tool:<name>` for a tool name, and `glob:<path-glob>` for a path.

### c4.C005
- key: Store the pattern verbatim, leaving what a pattern means against a running session to the surface that matches.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:213
- provenance: 0d1e610 2026-08-30, installed with the field.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 29 states "stored verbatim" as the verb's contract, and the author-facing consequence (a `cmd:` or `err:` pattern is a literal fragment matched by containment, an identifier is compared whole) rides the compressed matching paragraph (c4.C051, c4.C056); the division-of-labour clause is background.
- proposed: (via A009) Delete the sentence "The pattern is stored verbatim; what a pattern means ... rather than to this field."; the row at 29 carries "stored verbatim" and the compressed matching paragraph (A093) carries how each type is compared.

### c4.C006
- key: Expect the recognition nudge to match at four moments, two in every tool call and two in the session lifecycle, offering a type only where the moment carries a subject for it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, Section 3 of the memory-read-side plan added the prompt and dispatch moments to the two tool moments.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The four match moments go as hook implementation, enforced in `hooks/memory-recognition-nudge.js`.
- proposed: Compress the paragraph at line 215 to which types reach which moment, that the prompt draws from the project tier alone and from none under a store pin, that a dispatch delivers into the subagent's context, and the read-only seat exception as a pointer (A021); drop the per-moment rationale clauses.
- baseline-test: yes
- passage: **Four moments are matched, and each takes its own types.**

### c4.C007
- key: Before a call (`PreToolUse`), match `cmd:`, `skill:`, `agent:` and `tool:`, all knowable from the request.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, reworded; the tool-call moments were installed by Section 2 of the memory-recognition plan (2026-08-30).
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The match moment is hook implementation.
- proposed: (via A012) Compress the paragraph at line 215 to which types reach which moment, that the prompt draws from the project tier alone and from none under a store pin, that a dispatch delivers into the subagent's context, and the read-only seat exception as a pointer (A021); drop the per-moment rationale clauses.
- baseline-test: yes
- passage: Before a call (`PreToolUse`): `cmd:`, `skill:`, `agent:` and `tool:`.

### c4.C008
- key: After a call (`PostToolUse`), match `err:` and `glob:` plus the record's file anchors.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, reworded; the tool-call moments were installed by Section 2 of the memory-recognition plan (2026-08-30).
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The match moment is hook implementation.
- proposed: (via A012) Compress the paragraph at line 215 to which types reach which moment, that the prompt draws from the project tier alone and from none under a store pin, that a dispatch delivers into the subagent's context, and the read-only seat exception as a pointer (A021); drop the per-moment rationale clauses.
- baseline-test: yes
- passage: After it (`PostToolUse`): `err:` and `glob:`, plus the record's file anchors.

### c4.C009
- key: At the prompt (`UserPromptSubmit`), match `skill:`, `agent:`, `tool:`, `cmd:` and `err:` from the project tier alone against the prompt's own text.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, the commit narrates the incident: a prompt is prose, the bare-token screen says nothing about English, two English-frequency screens failed, and the rule that held is about reach (project tier alone, no tier under a pin).
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The match moment is hook implementation.
- proposed: (via A015) One sentence: at a prompt every type but `glob:` is matched from the project tier alone, and from no tier under a `KIT_MEMORY_PROJECT` pin.
- baseline-test: yes
- passage: At a prompt (`UserPromptSubmit`): every type but `glob:`, matched against the prompt's text from the project tier alone, and from no tier under a `KIT_MEMORY_PROJECT` store pin.

### c4.C010
- key: At a dispatch (`SubagentStart`), match `agent:` alone and land the pointer in the subagent's own context rather than the dispatcher's.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, the dispatch boundary is the only channel by which a subagent learns the store exists.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The match moment is hook implementation.
- proposed: (via A018) One clause: at a dispatch `agent:` alone is matched and the pointer lands in the subagent's context, except into a read-only judgment seat, which receives none.
- baseline-test: yes
- passage: At a dispatch (`SubagentStart`): `agent:` alone, with the pointer landing in the subagent's own context.

### c4.C011
- key: Deliver no pointer at all into a read-only judgment seat: a blind, adversarial, security or prose reviewer, consultant, blind reader, council member or design facilitator.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, a blind reviewer is dispatched to hold a context that inherited nothing and store-authored text is the intent story it is dispatched without.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The seat exception is `reviewAgentClass` in `hooks/kit-agent-identity-lib.js`.
- proposed: Replace the parenthetical seat list with "a read-only judgment seat, the strict class `reviewAgentClass` in `hooks/kit-agent-identity-lib.js` names".
- baseline-test: yes
- passage: The exception is a read-only judgment seat, the strict class `reviewAgentClass` in `hooks/kit-agent-identity-lib.js` names, which receives none.
- flag: stale

### c4.C012
- key: Treat a `glob:` pattern as a tool-stream trigger and nothing else, while the other five types can also be met by a prompt describing the work.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, the paragraph's closing summary of the map above it.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A restatement of c4.C008 and c4.C009 in summary form; the compressed map states each once and the hook skips a glob at the prompt (hooks/memory-recognition-nudge.js:1682).
- proposed: Delete as a separate sentence; A015's sentence carries it.
- baseline-test: yes

### c4.C013
- key: Screen patterns against a command line or failure output rather than English, since otherwise a pattern written elsewhere would aim at every session's opening prompt.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, the incident's own reasoning.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for c4.C009's confinement, obeyable without it; recorded under c4.C009 above.
- proposed: Delete the clause from "a prompt is prose rather than a field" to "every session everywhere".

### c4.C014
- key: Under a `KIT_MEMORY_PROJECT` store pin, take no tier at all at the prompt, one pinned segment serving every repository the instance runs in.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:215
- provenance: 653faed 2026-09-02, the pin case of the reach rule; d25d512 2026-09-02 made the path doors read the pin the same way.
- verdict: retire
- landed: d2c43f1 section 22
- reason: c4.C009's own bound, folded into c4.C009's sentence; enforced at hooks/memory-recognition-nudge.js:1714 and 1748.
- proposed: Fold into A015's sentence.
- baseline-test: yes

### c4.C015
- key: Allow a tool call two pointers and a prompt three, each spent from its own rolling two-minute window.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:217
- provenance: 653faed 2026-09-02, the budgets for the added moments.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Constants and branches in the hook (NUDGE_CAP_LIFECYCLE at hooks/memory-recognition-nudge.js:456, TURN_WINDOW_MS at 464) documented in its own header; no session act depends on the figures.
- proposed: Delete the paragraph at line 217.

### c4.C016
- key: Give a dispatch no window, bounding it instead by the three pointers of its one injection.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:217
- provenance: 653faed 2026-09-02; d25d512 2026-09-02 corrected the architecture doc that had described a rolling window at the dispatch.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The hook's per-injection cap (hooks/memory-recognition-nudge.js:452-456); instrument-internal.
- proposed: (via A025) Delete the paragraph at line 217.

### c4.C017
- key: Fire a trigger once per trigger per record per session in each of three classes: the two tool boundaries share one, the prompt and the dispatch hold one each.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:217
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The class split is the hook's (hooks/memory-recognition-nudge.js:1333-1335). The one author-facing residue lives here: a record declaring two entries that both match can carry two pointers, where one entry matching twice carries one.
- proposed: (via A025) Delete the paragraph at line 217.

### c4.C018
- key: Count the dispatch class per dispatched agent, since a subagent inherits no memory context and shares its parent's session id byte for byte.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:217
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The counting key is the hook's (hooks/memory-recognition-nudge.js:1286-1291); instrument-internal.
- proposed: (via A025) Delete the paragraph at line 217.

### c4.C019
- key: Write the triggers field through the CLI, never by hand.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 0d1e610 2026-08-30, the verb written in the anchor verb's idiom; 2b6e936 2026-09-02 added the second door.
- verdict: keep
- reason: The rule stands; the frontmatter guard catches a hand-written line on the project tier but the shared tiers refuse hand edits outright, and the guard is a net rather than the door. The paragraph around it compresses to this rule, c4.C031 and c4.C041 with a pointer at row 29 for the verb's mechanics.
- passage: Write it through the CLI, never by hand

### c4.C020
- key: Use one of two doors: `memq triggers <name> <type>:<pattern>...` on an existing record, or `--trigger <type>:<pattern>` on `add-type` or `add-operator` at creation.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 2b6e936 2026-09-02, of 242 shared records one had ever been given a handle, so the declaration moved to the moment of creation.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The doors survive inside c4.C019's rule sentence; the calling convention around them is each verb's row (29 and 30), which every verb in the document carries as its contract.
- proposed: (via A030) Reduce line 219 to: write the field through the CLI, never by hand, at either door (`memq triggers` on an existing record, `--trigger` on the add verb that creates one); `--replace` is how a wrong declaration is corrected, and on a shared tier it takes `--confirm-shared` since a replace states the line whole; a write that adds an entry moves the record's mtime, which on a shared tier postpones archival for every project and machine, so declare a trigger there because the recognition is worth having, never to keep a record alive; read stderr for whether a replace corrected a line or wrote a record's first. Point at the row for flags, tiers and refusals.
- baseline-test: yes
- passage: `memq triggers <name> <type>:<pattern>...` on a record that exists, or `--trigger <type>:<pattern>` on the `add-type` or `add-operator` that creates one.

### c4.C021
- key: Expect the verb to splice a single line into the record, leaving every other byte, the body most of all, exactly where it was.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 0d1e610 2026-08-30, in the anchor verb's idiom.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 29 and the anchors section at 184 both state the splice; the third copy leaves.
- proposed: (via A035) Delete "The verb splices a single line ... exactly where it was"; the row carries it.

### c4.C022
- key: Enforce one grammar at both doors, so a record's line reads the same whichever wrote it and the verb merges into a line the flag wrote.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 2b6e936 2026-09-02, the flag validated by exactly the rules the verb already applied.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Program behavior (the add verbs call the verb's parser) stated in row 30; nothing a session does depends on it.
- proposed: (via A038) Delete "One grammar is enforced at both ... a line the flag wrote."

### c4.C023
- key: Limit the `--trigger` flag to the two shared tiers at creation only, refusing the whole command with nothing written where any entry fails.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 2b6e936 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The add verbs' contract, stated in row 30 and at 166, and enforced (hooks/memq-grant.js:57-58, scripts/memq.js:5415); the section's copy is the third.
- proposed: (via A041) Delete "the flag's own half is the two shared tiers alone ... under the engine store signals".

### c4.C024
- key: Reach any tier with the verb: the project tier with neither flag, a run's own pending tier ahead of it, and the type or operator tier with `--type` or `--operator`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 72ddd3e 2026-09-01, the verb accepts the shared tiers so banked lessons can surface.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 29 owns the tier reach; the section's copy duplicates it.
- proposed: (via A044) Delete "The verb reaches any tier ... one of them or neither."

### c4.C025
- key: Use bare `--type` to take the tier from the working project's declared `Project-Type`, and `--type=<type>` to name the tier outright.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03, no project on this machine declares a type, so type-tier records were unreachable until the tier could be named directly.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Stated in rows 23, 27 and 29, the first two deferring to the `triggers` row by name; the section's copy is the fourth. The named spelling is withheld under the engine store signals because it widens what a worker reads and stamps to any tier (line 166).
- proposed: (via A047) Delete "`--type` has two spellings ... declares no type."

### c4.C026
- key: Refuse a `glob:` entry under either shared-tier flag; only five of the six types reach a shared tier.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 72ddd3e 2026-09-01, refused at the authoring door as well as the reading one because gating only the reader would mint triggers nothing ever reads.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Enforced (SHARED_TRIGGER_TYPES at scripts/memq.js:532, the refusal at 11094) with the reason in the refusal text itself (SHARED_TIER_GLOB_REFUSAL at 543), and stated in rows 29 and 30.
- proposed: (via A050) Delete "Five of the six types reach a shared tier ... another project's files."

### c4.C027
- key: Refuse shared-tier globs because a glob is relative to the matching session's project root, so one on a machine-wide tier fires one project's record on another's files.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 72ddd3e 2026-09-01.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for c4.C026, which the CLI's own refusal states; recorded here and at scripts/memq.js:533-543.
- proposed: (via A050) Delete "Five of the six types reach a shared tier ... another project's files."

### c4.C028
- key: Expect `memq anchor` to refuse the shared tiers outright and the recognition surface to skip a hand-placed shared-tier glob.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 72ddd3e 2026-09-01.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The anchor refusal is row 28's and line 184's; the reader's skip is the hook's (hooks/memory-recognition-nudge.js:1682) and row 29's. A cross-reference adding nothing either owner lacks. Lands with row 28 and the anchors paragraph no longer stating the anchor verb's shared-tier refusal (c1.C054, c3.C050); the verb's refusal and the hook's skip carry it. The anchor verb's refusal is not outright on the operator tier: a record whose `machine:` names this host is admitted, per c1.C054's reason.
- proposed: (via A054) Delete "That is the same reason `memq anchor` refuses ... nothing would act on."

### c4.C029
- key: Merge rather than replace on a write: an entry already on the line keeps its position and changes nothing, and one not carried is appended.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 0d1e610 2026-08-30, in the anchor verb's idiom.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. Merge semantics are the verb's, and the merge is stated in the `memq triggers` reference row.
- proposed: (via A057) Replace the merge sentence with a pointer clause: "The write merges as `memq anchor`'s does, and an entry already on the line changes nothing, a trigger being its own value whole where an anchor carries a hash."
- passage: The write merges as `memq anchor`'s does, and an entry already on the line changes nothing, a trigger being its own value whole where an anchor carries a hash.

### c4.C030
- key: Use `--replace` to write the named entries in place of the line, and name none to remove the line entirely.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03, about fifteen of 185 shared-tier marks were wrong and the only route was deleting the record with its body and history.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Row 29 owns the flag's mechanics; the section keeps the purpose the incident bought, that a wrong declaration is corrected, narrowed, respelled or withdrawn without deleting the record. The second proposal 'As A060.' names this entry's own ruling in the c4 unit's numbering (A060 sits between c4.C029's A057 and c4.C033's A066), whose proposal is the A030 text, so the A030 wording landed; the spec's Decisions block carries no A060.
- proposed: (via A030) Reduce line 219 to: write the field through the CLI, never by hand, at either door (`memq triggers` on an existing record, `--trigger` on the add verb that creates one); `--replace` is how a wrong declaration is corrected, and on a shared tier it takes `--confirm-shared` since a replace states the line whole; a write that adds an entry moves the record's mtime, which on a shared tier postpones archival for every project and machine, so declare a trigger there because the recognition is worth having, never to keep a record alive; read stderr for whether a replace corrected a line or wrote a record's first. Point at the row for flags, tiers and refusals.
- proposed: As A060.
- baseline-test: yes
- passage: `--replace` is how a wrong declaration is corrected, narrowed, respelled or withdrawn without deleting the record.

### c4.C031
- key: Pass `--confirm-shared` with `--replace` on the type or operator tier; without it the command refuses with nothing written.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03, the replace turned an authoring command into a destructive one, so it took the two locks every other destructive shared-tier write carries.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The CLI refuses without the flag (scripts/memq.js:10340), but a consent flag without its reason is a reflex; the rule stays with c4.C032's reason as one clause, and consent generally is owned at line 157. Row 29 also carries the pinned-store case this sentence omits. Flipped from keep to rewrite at section 22's close: c4.C032's rewrite compressed its reason to one clause, so the sentence was respelled to stand as landed. Landed as the proposal below. The pinned project store rides the landed sentence, since row 29's copy of that case retired under c1.C060 and memq.js admits the flag there (near its line 10845).
- proposed: On the type or operator tier, or a pinned project store, it takes `--confirm-shared`, refusing with nothing written without it, since a replace states the line whole.
- passage: On the type or operator tier, or a pinned project store, it takes `--confirm-shared`, since a replace states the line whole.

### c4.C032
- key: Gate the shared-tier replace because a replace states the line whole, dropping every unnamed declaration on a tier every project reads and every machine syncs to.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Compresses to the clause "since a replace states the line whole" inside c4.C031; the longer account lives here: a merge only adds, a replace drops every entry the invocation does not name, and which entries a record carries is exactly what a caller correcting it cannot be assumed to know, so the bar is on reaching a shared tier at all rather than on a run that turns out to drop something. Its landing respelled c4.C031's keep sentence; c4.C031 records the flip.
- proposed: Compress to the clause in A030; delete "The bar is on the flag reaching ... cannot be assumed to know."
- baseline-test: yes
- passage: since a replace states the line whole

### c4.C033
- key: Refuse the shared-tier replace shape outright under the engine store signals, consent or no consent.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03, the local `.bak` never syncs off a fleet worker, so a correction there is as final as a delete.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Stated at 29, 157, 166 and 219, enforced in memq (10340) and screened in the grant hook (64-72); line 166 owns it with its two-lock reason.
- proposed: (via A066) Delete "Under the engine store signals that same shape ... as final as a delete."

### c4.C034
- key: Allow the merge to declare a trigger under the engine store signals, and have refusals there name that state rather than a command the environment answers with a refusal.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03; 2b6e936 2026-09-02 installed the same pattern for the flag's no-trigger note.
- verdict: retire
- landed: d2c43f1 section 22
- reason: What a refusal names is the CLI's (scripts/memq.js:3387-3392, 5415), and row 29 states the merge still declares there.
- proposed: Delete "The merge still declares a trigger there ... answers with a refusal."

### c4.C035
- key: Hold every bar under the engine store signals: the grammar, the shared-tier glob refusal and the entry cap alike.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A reassurance about checks that run regardless of environment; no session act depends on it.
- proposed: Delete "Every bar above holds under it ... the entry cap alike."

### c4.C036
- key: Refuse on a line cut at the reader's bound, but drop an entry no reader can read and name it on stderr as it comes off.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03, the replace exists most for a declaration wrong in the one way the record cannot state.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 29 states the `--replace` fork; the section stated it twice more (219, 227). The reason lives here: the cut tail is text nothing has read and no report can name, while an unreadable entry was already shown to the caller by the refusal text. Lands with row 29's refusal passage, the --replace fork included, retired under c1.C060; the refusal names the entry and the rule it met, and this reason is the only prose account.
- proposed: (via A071) Delete "The two refusals that exist because a rewrite would drop text ... applied history."

### c4.C037
- key: Write the resulting line to stdout, and write nothing there for a `--replace` that leaves the record carrying no line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The verb's output, discoverable by running it.
- proposed: Delete "The line as written goes to stdout ... no record holds".

### c4.C038
- key: Read stderr for what a run did: which entries arrived, which came off, which were dropped unreadable, and whether a replace corrected a line or wrote the first.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 9b1180b 2026-09-03.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The stderr reading is the verb's own output.
- proposed: (via A030) Reduce line 219 to: write the field through the CLI, never by hand, at either door (`memq triggers` on an existing record, `--trigger` on the add verb that creates one); `--replace` is how a wrong declaration is corrected, and on a shared tier it takes `--confirm-shared` since a replace states the line whole; a write that adds an entry moves the record's mtime, which on a shared tier postpones archival for every project and machine, so declare a trigger there because the recognition is worth having, never to keep a record alive; read stderr for whether a replace corrected a line or wrote a record's first. Point at the row for flags, tiers and refusals.
- baseline-test: yes
- passage: Read stderr for whether a replace corrected a line or wrote the record's first, since a mistyped record name is all that separates them.

### c4.C039
- key: Expect a run that adds nothing to print the line, say every entry was already present, and leave the record's bytes, backup generation and mtime as found.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 0d1e610 2026-08-30, a redundant call stopped spending a backup generation and moving the mtime the decay pass reads.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 29 states the no-op for merge and replace alike; the verb performs it.
- proposed: (via A076) Delete "A run that adds nothing writes nothing at all ... carries no line."

### c4.C040
- key: Expect a run that adds an entry to rewrite the line, leave one generation of previous text in `<name>.md.bak`, and move the record's mtime.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 0d1e610 2026-08-30; the shared-tier deferral clause by 72ddd3e 2026-09-01.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: Line 184 names `triggers` as the third verb spending the backup and line 258 states the sweep; the section keeps only the mtime consequence c4.C041 needs, folded into c4.C041's sentence. The second proposal 'As A079.' names this entry's own ruling (A079 sits between c4.C039's A076 and c4.C042's A082), whose proposal is the A030 text; the mtime consequence landed folded before c4.C041's sentence, and the spec's Decisions block carries no A079. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: (via A030) Reduce line 219 to: write the field through the CLI, never by hand, at either door (`memq triggers` on an existing record, `--trigger` on the add verb that creates one); `--replace` is how a wrong declaration is corrected, and on a shared tier it takes `--confirm-shared` since a replace states the line whole; a write that adds an entry moves the record's mtime, which on a shared tier postpones archival for every project and machine, so declare a trigger there because the recognition is worth having, never to keep a record alive; read stderr for whether a replace corrected a line or wrote a record's first. Point at the row for flags, tiers and refusals.
- proposed: As A079.
- baseline-test: yes
- passage: A write that adds an entry moves the record's update time, and on a shared tier that postpones the record's archival for every project and machine reading it.

### c4.C041
- key: Declare a trigger on a shared-tier record because the recognition is worth having, never to keep a record alive.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 72ddd3e 2026-09-01, once the verb reached the shared tiers a project's write moved a record's mtime for every project and machine reading the tier.
- verdict: keep
- reason: `lastAliveMs` reads the mtime and no machinery distinguishes a declaration made for recognition from one made to postpone archival; the rule stands with its mtime clause.
- passage: So declare a trigger on a shared-tier record because the recognition is worth having, not to keep a record alive.

### c4.C042
- key: Read `memq recall` for each shared tier's coverage line counting records that declare no trigger, and stderr when an add verb lands a record with no `--trigger`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 2b6e936 2026-09-02, the omission made visible when it happens rather than two hundred records later.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The `recall` coverage line prints the count itself.
- proposed: (via A082) Keep "`memq recall` counts the records of the type tier and of the operator tier that declare no trigger, on each tier's own coverage line"; drop the stderr clause, which row 30 carries.
- passage: `memq recall` counts the records of the type tier and of the operator tier that declare no trigger, on each tier's own coverage line.

### c4.C043
- key: Refuse a pattern shorter than four characters.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:221
- provenance: 0d1e610 2026-08-30, the two specificity bars installed with the field.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Enforced at both doors and the write door (TRIGGER_PATTERN_MIN at scripts/memq.js:498, the check at 4186; hooks/memory-frontmatter-guard.js:1173) with a refusal naming the rule.
- proposed: Delete the paragraph at line 221 except the pointer that the two bars exist and the refusal names which one was met.

### c4.C044
- key: Refuse a pattern that is a bare common token whatever its length, compared without regard to case.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:221
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Enforced (TRIGGER_COMMON_TOKENS at scripts/memq.js:521, the check at 4197-4198) with a refusal naming the rule; `cmd:node --test` passes because the bar is on the whole pattern.
- proposed: (via A085) Delete the paragraph at line 221 except the pointer that the two bars exist and the refusal names which one was met.

### c4.C045
- key: Keep both bars because a pattern loose enough to appear in unrelated work nudges on everything and is read as noise within an hour.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:221
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for two refusals the CLI applies; recorded here: a loose pattern costs more than the memory it points at, because the nudge channel is read as noise once it fires on unrelated work.
- proposed: (via A085) Delete the paragraph at line 221 except the pointer that the two bars exist and the refusal names which one was met.

### c4.C046
- key: Rely on the reader's project-tier confinement, not the specificity bars, to keep a stored pattern off a prompt's prose.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:221
- provenance: 653faed 2026-09-02, the bare-token screen was the right property for a command line and said nothing about English.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Once c4.C009 states the confinement, a shared-tier author knows their pattern never meets prose; the reconciliation clause is c4.C009's reason and is recorded there.
- proposed: (via A085) Delete the paragraph at line 221 except the pointer that the two bars exist and the refusal names which one was met.

### c4.C047
- key: Ask the length floor of all six types.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:223
- provenance: 0d1e610 2026-08-30, the bars scoped by type class.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A per-type branch in the grammar (scripts/memq.js:499-514) whose refusal names itself.
- proposed: Delete the paragraph at line 223.

### c4.C048
- key: Ask the bare-token bar of `cmd:`, `err:` and `glob:` alone.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:223
- provenance: 0d1e610 2026-08-30, so that `tool:Bash` is authorable and `cmd:node` is not.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The `fragment` branch at scripts/memq.js:4197; the refusal names the bar and the remedy.
- proposed: (via A089) Delete the paragraph at line 223.

### c4.C049
- key: Exempt the identifier types because their pattern is a whole identifier with no longer spelling, so the bar would make the trigger unauthorable.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:223
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for c4.C048's scope; recorded here so a session widening the bar to identifiers knows it would make `tool:Bash` and `tool:Grep` unauthorable.
- proposed: (via A089) Delete the paragraph at line 223.

### c4.C050
- key: Have an identifier refused at the length floor say the name is too short rather than telling its author to lengthen something they do not control.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:223
- provenance: 0d1e610 2026-08-30, each type class given refusal wording its author can act on.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal's own wording, seen at the refusal.
- proposed: (via A089) Delete the paragraph at line 223.

### c4.C051
- key: Compare `skill:`, `agent:` and `tool:` whole against the tool call's own identifier field, so `tool:Bash` names Bash and not BashOutput.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:225
- provenance: 653faed 2026-09-02, a tool call carries the identifier in a field so matching it is a statement about the call.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. This is parsing detail of the hook's matcher.
- proposed: Reduce line 225 to: `skill:`, `agent:` and `tool:` are compared whole against a tool call's identifier field and as a whole token against a prompt's text, so `tool:Bash` names Bash and not BashOutput and `tool:Read` does not meet "thread"; `cmd:` and `err:` are matched by containment everywhere.
- baseline-test: yes
- passage: `skill:`, `agent:` and `tool:` are compared whole against a tool call's identifier field

### c4.C052
- key: Match those three identifier types against a prompt on a whole token, the identifier standing as its own word rather than merely appearing inside one.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:225
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. This is parsing detail of the hook's matcher.
- proposed: (via A093) Reduce line 225 to: `skill:`, `agent:` and `tool:` are compared whole against a tool call's identifier field and as a whole token against a prompt's text, so `tool:Bash` names Bash and not BashOutput and `tool:Read` does not meet "thread"; `cmd:` and `err:` are matched by containment everywhere.
- baseline-test: yes
- passage: as a whole token against a prompt's text, so `tool:Bash` names Bash and not BashOutput and `tool:Read` does not meet "thread".

### c4.C053
- key: Require the token boundary because bare containment would make `tool:Read` match "thread", "readme" and "spread", spending the class so the right match never arrives.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:225
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for c4.C052, recorded here: a false positive at a prompt spends the once-per-class budget, so the right match later in the session never fires.
- proposed: (via A093) Reduce line 225 to: `skill:`, `agent:` and `tool:` are compared whole against a tool call's identifier field and as a whole token against a prompt's text, so `tool:Bash` names Bash and not BashOutput and `tool:Read` does not meet "thread"; `cmd:` and `err:` are matched by containment everywhere.

### c4.C054
- key: Treat an above-ASCII letter as a token character, and the punctuation, separator and surrogate blocks of that range as boundaries.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:225
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The matcher's character classification, pinned in test/memory-recognition-nudge.test.js; no author composes against it.
- proposed: Delete the sentence from "An above-ASCII LETTER" to "as its own word."

### c4.C055
- key: Treat a hyphen or dot as a token character where it joins two word parts and as punctuation where it ends a sentence; treat a slash and a colon as boundaries always.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:225
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The matcher's boundary rules; the one author-facing consequence, that `agent:implementer-opus` meets a prompt writing `grimoire:implementer-opus`, is recorded here.
- proposed: Delete the sentence from "A hyphen or a dot" to "`grimoire:implementer-opus`."

### c4.C056
- key: Match `cmd:` and `err:` by containment wherever they are matched, being fragments of something longer by construction.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:225
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. This is parsing detail of the hook's matcher.
- proposed: (via A093) Reduce line 225 to: `skill:`, `agent:` and `tool:` are compared whole against a tool call's identifier field and as a whole token against a prompt's text, so `tool:Bash` names Bash and not BashOutput and `tool:Read` does not meet "thread"; `cmd:` and `err:` are matched by containment everywhere.
- baseline-test: yes
- passage: `cmd:` and `err:` are matched by containment everywhere.

### c4.C057
- key: Tolerate the prompt's reading of prose only where the record reaches one checkout, which is why the prompt takes every type from the project tier alone.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:225
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A restatement of c4.C013 at the end of the matcher paragraph; the reason is recorded under c4.C009.
- proposed: Delete the sentence from "That reading of prose is tolerable" to "many repositories share."

### c4.C058
- key: Expect every refusal to leave the record byte for byte as it was.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 426bf68 2026-08-26 for anchors; 0d1e610 2026-08-30 copied it for triggers in the anchor verb's idiom.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A property of the rewrite channel both verbs share (scripts/memq.js:183), stated once at 186; the triggers copy is a duplicate.
- proposed: Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.
- proposed: Delete "Every refusal leaves the record byte for byte as it was" from 227; where the section still needs the fact, point at the anchors section.

### c4.C059
- key: Expect the flag door to share the grammar shapes alone, adding a refusal under the engine store signals reaching every entry and an entry count over the cap.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 2b6e936 2026-09-02, the flag refused in the unattended environment and screened again in the grant hook because the two layers judge the environment in separate processes.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Code paths (hooks/memq-grant.js:57-58, scripts/memq.js:5415) stated as the add verbs' contract in row 30 and at 166.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C060
- key: Refuse an entry outside the grammar, naming every refused entry together rather than the first alone.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 29 states the batched refusal and the CLI performs it; the two-of-four rerun reason is recorded here.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C061
- key: Refuse a type outside the six, a pattern past 256 characters, a comma, an invisible character, a quote of either kind, an opening bracket, a backslash, or non-space whitespace.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Checked at both doors (TRIGGER_TYPES 467, TRIGGER_PATTERN_CAP 468, the charset checks from 4144 in scripts/memq.js) with a refusal naming the character; line 186 states the document's own principle that the list is what a refusal tells you rather than something to hold in your head.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C062
- key: Refuse the sequences `": "`, `" #"`, and a trailing `":"` in a pattern.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30, closing a record-destroying injection.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Checked at scripts/memq.js:4144-4145 with the reasons in the code's comment at 4101-4108; the refusal names the sequence.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C063
- key: Bar those sequences because `": "` opens a mapping value and breaks the whole frontmatter block, `" #"` silently stores a shortened pattern, and a trailing `":"` is a mapping indicator.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for c4.C062, held here and at scripts/memq.js:4101-4108: the line is a YAML plain scalar, so admitting the space makes three ordinary characters into syntax, and `": "` takes the whole block down, `pinned:` included.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C064
- key: Spell the bars at the sequences rather than at the characters, admitting `err:Error:cannot find module` and `cmd:foo#bar` while refusing `err:Error: cannot find module`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Decided in code; a refusal on the space-colon sequence names the sequence, which tells the author the bar is not at the colon. The reason, that an error signature has colons by nature, is recorded here.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C065
- key: Bar the opening bracket because `get` prints admitted entries beside refusals annotated as `[note; note]`, so a free `[` could forge one byte for byte.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for a character already in the refused set; recorded here for a session tempted to admit `[`.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C066
- key: Bar the backslash because a double-quoted YAML scalar doubles it on the round trip, so a re-declared entry appends a second rather than matching the first.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for the backslash bar and for c4.C067; recorded here: the read-back takes a surrounding quote off without undoing the escape, so a backslash pattern comes back doubled, fails to match its own re-declaration, and doubles again on the next pass. Its landing respelled c4.C067's keep sentence; c4.C067 records the flip.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C067
- key: Spell a win32 path forward-slashed inside a `cmd:` pattern.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. This is parsing detail, and the refusal names the character.
- proposed: A win32 path in a `cmd:` pattern is spelled forward-slashed.
- passage: A win32 path in a `cmd:` pattern is spelled forward-slashed.

### c4.C068
- key: Give a `glob:` pattern the anchor path grammar with `*` and `?` admitted: relative, forward-slashed, refusing an absolute path, `..`, a backslash, a colon, dots-only or trailing-dot segments, reserved device stems and a leading YAML indicator.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30, one path grammar both fields answer to (scripts/memq.js:3833).
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. This is parsing detail, and the refusal names the rule met.
- proposed: (via A114) One clause: "a `glob:` pattern takes the anchor path grammar with `*` and `?` admitted and a single quote refused anywhere".
- passage: A `glob:` pattern takes the anchor path grammar with `*` and `?` admitted and a single quote refused anywhere.

### c4.C069
- key: Refuse a single quote anywhere in a `glob:` pattern, where the anchor path grammar refuses it in the lead position alone.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. This is parsing detail, and the refusal names the rule met.
- proposed: (via A114) One clause: "a `glob:` pattern takes the anchor path grammar with `*` and `?` admitted and a single quote refused anywhere".
- passage: A `glob:` pattern takes the anchor path grammar with `*` and `?` admitted and a single quote refused anywhere.

### c4.C070
- key: Refuse a name the store will not answer for, or a pending tier whose entry for that name could not be examined, rather than reading it as an absence.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 5ac33f5 2026-08-25 for the anchor verb's pending-tier refusal; 0d1e610 2026-08-30 copied it for triggers.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The rewrite channel's refusal, stated with its reason at 186 and in row 29; the triggers copy is a near-verbatim duplicate. Lands with row 29's copy retired under c1.C060 and the triggers paragraph's copy retired under c3.C056; the refusal names itself.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C071
- key: Refuse a record no reader can read: a frontmatter block that never closes inside the line bound, a `triggers:` key under something other than `metadata:`, or invalid UTF-8.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30, in the anchor verb's idiom.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Stated at 186 with the same three shapes and in row 29; differs by the field name only. Lands as c4.C070 records: no prose copy remains at row 29 or in the triggers paragraph.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C072
- key: Refuse a line the write cannot preserve whole: one carrying an entry the reader refuses, one already longer than a reader reads, or a write pushing the record past 32 entries.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 0d1e610 2026-08-30; the `--replace` fork by 9b1180b 2026-09-03.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Stated at 186 and in row 29 (which carries the `--replace` fork); enforced by TRIGGER_ENTRIES_MAX at scripts/memq.js:469. Lands as c4.C070 records: row 29's copy with the --replace fork is retired under c1.C060, and TRIGGER_ENTRIES_MAX enforces the bound.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C073
- key: Expect exactly three surfaces to read the field deliberately, unlike the anchors field's longer reader list.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:229
- provenance: 2b6e936 2026-09-02, installed with the coverage line.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A count of reading surfaces is a restated enumeration that no test pins against the code, and each surface's behavior is discoverable by running it; row 23 already states `get`'s trigger lines and the guard's section owns the guard.
- proposed: Delete the paragraph at line 229.

### c4.C074
- key: Expect `memq get` to follow a record's body with one `triggers:` line per entry and nothing for a record declaring none.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:229
- provenance: 72ddd3e 2026-09-01, `get` gained the tier flags and the trigger listing when the nudge started naming shared-tier records.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 23 states it; the verb performs it.
- proposed: (via A127) Delete the paragraph at line 229.

### c4.C075
- key: List every tier's record on `get`, unlike the anchors field whose shared-tier rung cannot be checked at all.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:229
- provenance: 72ddd3e 2026-09-01.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The verb's tier coverage; the contrast with anchors is c4.C003's reason, recorded there.
- proposed: (via A127) Delete the paragraph at line 229.

### c4.C076
- key: Place the trigger lines wherever the body rode: column zero for a body the reading session owns, indented two spaces under the provenance fence otherwise.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:229
- provenance: 72ddd3e 2026-09-01, a dispatched agent keyed the indent on the fence rather than the tier and was right, since a pinned project tier's body is fenced.
- verdict: retire
- landed: d2c43f1 section 22
- reason: `get`'s output under the store-wide rule that an indented line is data; the keying lesson is recorded here.
- proposed: (via A127) Delete the paragraph at line 229.

### c4.C077
- key: Have the frontmatter guard read the field at the write door, refusing an entry outside the grammar on a Write, an Edit or a MultiEdit that lands one.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:229
- provenance: 0d1e610 2026-08-30, the guard learned the field and its check was restructured under a rank rule after a hoist made every deny below it unreachable.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The guard's own behavior (hooks/memory-frontmatter-guard.js:941, 1173-1176), owned by the guard section of this document.
- proposed: (via A127) Delete the paragraph at line 229.

### c4.C078
- key: Have `memq recall` read the field to count only, carrying per-tier coverage of records declaring no admitted trigger and never saying what any one record recognizes.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:229
- provenance: 2b6e936 2026-09-02, the count corrected to treat a glob-only shared record as uncovered.
- verdict: retire
- landed: d2c43f1 section 22
- reason: `recall`'s own output (scripts/memq.js:8036-8042); the reading of the coverage line survives under c4.C042.
- proposed: (via A127) Delete the paragraph at line 229.

### c4.C079
- key: Expect `decay-scan` to report no triggers column, a pattern having no bytes that could have changed and so no drift.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:229
- provenance: 2b6e936 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: An absent column is the verb's; the reason is c4.C003's, recorded there.
- proposed: (via A127) Delete the paragraph at line 229.

### c4.C080
- key: Expect `find` to carry no trigger label on either channel, no hit line saying anything about what a record recognizes.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:231
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 188 states that `find` carries no field label on either channel; one statement covers both fields.
- proposed: (via A136) Delete the first two sentences of line 231 ("`find` carries no trigger label ... anchor label."); the paragraph opens on the embedder fact folded into C082 (A140).

### c4.C081
- key: Expect the embedder to read each record file whole, frontmatter included, and to re-embed on the next `find` after a `memq triggers` write changes the hash.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:231
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. The embedder detail falls outside the row's kept content.
- proposed: (via A140) One sentence: "A pattern is search surface as well as a recognition rule: the embedder reads the record file whole, frontmatter included, so a line of patterns shifts the record's vector by the text it adds."
- baseline-test: yes
- passage: the embedder reads the record file whole, frontmatter included, so a line of patterns shifts the record's vector by the text it adds.

### c4.C082
- key: Compose a pattern knowing it is a few words of search surface as well as a recognition rule, shifting the record's vector by the text it adds.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:231
- provenance: 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 900 (triggers: field declaration) shrink. This is outside the row's kept content. c4.C083's landed sentence ("published as a body is, synced and embedded") carries the premise.
- proposed: One sentence: "A pattern is search surface as well as a recognition rule: the embedder reads the record file whole, frontmatter included, so a line of patterns shifts the record's vector by the text it adds."
- baseline-test: yes
- passage: A pattern is search surface as well as a recognition rule: the embedder reads the record file whole, frontmatter included, so a line of patterns shifts the record's vector by the text it adds.

### c4.C083
- key: Treat a pattern as published once written: the project tier syncs to the private remote and the semantic index embeds the record file whole.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:233
- provenance: 0d1e610 2026-08-30.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The premise of the two secrets rules; survives as one clause of the compressed paragraph, since publication is automatic and the stance is the author's.
- proposed: (via A143) Reduce line 233 to: "A `cmd:` pattern is a command line, which is where a token gets typed, and a pattern is published as a body is (synced, embedded), so the field takes the body's rule: name the shape of the command rather than the invocation that carried the secret, and a credential that reached a trigger line is rotated, per the deletion rule above."
- baseline-test: yes
- passage: A pattern is published as a body is, synced and embedded.

### c4.C084
- key: Rotate any credential a record's trigger line carried; neither a rewrite of the line nor an unlink of the record is a redaction.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:233
- provenance: 0d1e610 2026-08-30; the rotation rule itself is the four-remedies paragraph's (162) and the deletion-history rule's (164), extended to the project tier at 205.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The field takes the record body's rule, as the sentence itself says, so it becomes a pointer at that rule with the field-specific premise that a `cmd:` pattern is where a token gets typed.
- proposed: (via A143) Reduce line 233 to: "A `cmd:` pattern is a command line, which is where a token gets typed, and a pattern is published as a body is (synced, embedded), so the field takes the body's rule: name the shape of the command rather than the invocation that carried the secret, and a credential that reached a trigger line is rotated, per the deletion rule above."
- baseline-test: yes
- passage: A credential that reached a trigger line is rotated, per the deletion rule above.

### c4.C085
- key: Name the shape of the command in a `cmd:` pattern rather than the invocation that carried the secret.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:233
- provenance: 0d1e610 2026-08-30.
- verdict: keep
- reason: The journal rule at 86 is bounded to a journal entry; this is the same principle applied to a different surface, and no passage owns the store-wide principle (the ownership map has no row), which the rewrite plan should place once and declare rather than fold silently.
- passage: **A `cmd:` pattern names the shape of the command, never the invocation that carried a secret.**

### c4.C086
- key: Grant the `triggers` verb nothing at all under the engine store signals, for the reason `anchor` gets none and over a wider blast radius.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:235
- provenance: 0d1e610 2026-08-30 withheld the verb deliberately (GRANTED_VERBS is an allowlist); 72ddd3e 2026-09-01 widened the reason when the verb reached the shared tiers.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 166 states the withholding whole with its blast-radius reason and the `--replace` second lock, and hooks/memq-grant.js:264-282 and 295 enforce it; this paragraph repeats it in short.
- proposed: (via A147) Delete the paragraph at line 235.

### c4.C087
- key: Append one line per claimed nudge to `.kit/memory-recognition-nudges.jsonl` under the project's resolved main checkout root, so every worktree of one repository shares one log.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:239
- provenance: dda9892 2026-08-30, the log keyed on the raw working directory would have scored a worktree's nudged-and-applied record as unnudged, inverting the experiment.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- proposed: Reduce line 239 to: the hook appends each nudge it claims to `.kit/memory-recognition-nudges.jsonl` under the project's resolved main checkout root (one log per repository, machine-local, never synced); absence means no nudge has fired on this box; past 1 MB it rotates to `.old`, so a wide window sees fewer nudges than fired; read a window across which a `KIT_MEMORY_PROJECT` pin did not move.
- baseline-test: yes
- passage: `memory-recognition-nudge.js` appends each nudge it claims to `.kit/memory-recognition-nudges.jsonl` under the project's resolved main checkout root, so every worktree of one repository shares one log.
- passage: The log is machine-local, never synced, and read by no store verb or hook.
- ruled: cut 2026-09-30

### c4.C088
- key: Write the log line as `{ts, name, tier, type, pattern, boundary}`, once per record a claimed emission names, inside the same lock that claims the emission and before that lock releases.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:239
- provenance: dda9892 2026-08-30, the append moved under the marker lock after a rotation racing an append could strand a claimed nudge in the rotated file.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The hook's own write discipline (hooks/memory-recognition-nudge.js:2085-2088); the function consumes the fields and no reader depends on the timing.
- proposed: (via A150) Reduce line 239 to: the hook appends each nudge it claims to `.kit/memory-recognition-nudges.jsonl` under the project's resolved main checkout root (one log per repository, machine-local, never synced); absence means no nudge has fired on this box; past 1 MB it rotates to `.old`, so a wide window sees fewer nudges than fired; read a window across which a `KIT_MEMORY_PROJECT` pin did not move.

### c4.C089
- key: Read absence of the log file as no nudge having fired yet on this box, the same convention the store's sidecars take for an absent `usage.jsonl`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:239
- provenance: dda9892 2026-08-30, per the plan's Section 3 (its absence reads as no-nudges-yet rather than as an error).
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: An absent file means no nudge has fired on this box yet, as an absent `usage.jsonl` does for the store.
- ruled: cut 2026-09-30

### c4.C090
- key: Expect the log to rotate to `.old` past 1 MB, replacing any previous one, so a window reaching past the rotation sees fewer nudges than fired rather than an error.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:239
- provenance: dda9892 2026-08-30; 4200d16 2026-08-30 made the report refuse an over-large log but nothing reports lines a rotation already dropped.
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: Past 1 MB the log rotates to `.old`, replacing any previous one, so a window reaching past the rotation silently sees fewer nudges than fired.
- ruled: cut 2026-09-30

### c4.C091
- key: Read a window across which the `KIT_MEMORY_PROJECT` pin did not move, since a pin change joins one checkout's log against a different segment's stamps.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:239
- provenance: 4200d16 2026-08-30, with the resolver split (the tier follows the pin, the log stays at the checkout) that 555407f 2026-09-01 then single-sourced.
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: Under a `KIT_MEMORY_PROJECT` pin the tier follows the pin while the log stays at the checkout, so read a window across which the pin did not move.
- ruled: cut 2026-09-30

### c4.C092
- key: Treat the log as evidence of what the hook decided to show, not a certified receipt of what a session read, since the append lands on the claim before the emission.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:241
- provenance: dda9892 2026-08-30, the append lands under the claim lock and before the response write.
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: The append lands when the hook claims the nudge, before its process emits the line to the transcript. So the log is evidence of what the hook decided to show, not a certified receipt of what a session read.
- ruled: cut 2026-09-30

### c4.C093
- key: Do the nudge-to-stamp join by hand or from a short script, never with a `memq` verb, since it correlates the log with the store's applied stamps.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: dda9892 2026-08-30, the log is scratch outside the store by design.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- proposed: Reduce line 243 to: the reading is a join done by hand or from a short script, never by a `memq` verb, since the log is not part of the store; `memory-recognition-nudge.js` exports it as `nudgeStampRate(cwd, sinceMs)`, both arguments required; and a pointer at the archived recognition plan's decision 2 for what the number gates.
- baseline-test: yes
- passage: The reading is a join done by hand or from a short script, never by a `memq` verb, since the log is not part of the store.
- ruled: cut 2026-09-30

### c4.C094
- key: Call `nudgeStampRate(cwd, sinceMs)` exported by `memory-recognition-nudge.js`, passing the project working directory and the window start in epoch milliseconds.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: dda9892 2026-08-30 (the export at hooks/memory-recognition-nudge.js:2486, 2788).
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: `memory-recognition-nudge.js` exports it as `nudgeStampRate(cwd, sinceMs)`: the project working directory and the window start in epoch milliseconds. Both are required, so no report goes out without a stated window.
- ruled: cut 2026-09-30

### c4.C095
- key: Split the project tier's live nudgeable records into nudged, dispatched and unnudged by whether the log names them in-session, only into a dispatched context, or not at all.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: dda9892 2026-08-30 the two arms; 653faed 2026-09-02 the dispatched arm; d25d512 2026-09-02 its floor.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Computed inside `nudgeStampRate` and documented in the hook's header; a reader of the number needs c4.C107 to c4.C112 and not the grouping algorithm.
- proposed: Delete from "It splits the project tier's live, nudgeable records" to "is not folded into a zero rate."

### c4.C096
- key: Hold the dispatched arm apart because a pointer landing in a subagent's context reached a reader that ends with the dispatch and cannot realistically earn an applied stamp.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The reason for the third arm, recorded here: folded into the nudged arm it would grow that denominator with a population that cannot earn a stamp, and folded into the control it would be no fair control.
- proposed: (via A158) Delete from "It splits the project tier's live, nudgeable records" to "is not folded into a zero rate."

### c4.C097
- key: Draw both groups from the project tier's own listing, so a shared-tier line naming a same-named record cannot score the project-tier record as nudged.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: 72ddd3e 2026-09-01, the nudge began spanning three tiers.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The function's tier filter; recorded here that widening the reading to shared tiers is a separate question, since their stamps are written by every project while the log holds one project's nudges.
- proposed: (via A158) Delete from "It splits the project tier's live, nudgeable records" to "is not folded into a zero rate."

### c4.C098
- key: Exclude a record carrying no trigger or anchor at all from both groups, since it could never earn a nudge and is no fair control.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: dda9892 2026-08-30, the control arm had held records that can never be nudged.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The function's exclusion; instrument-internal.
- proposed: (via A158) Delete from "It splits the project tier's live, nudgeable records" to "is not folded into a zero rate."

### c4.C099
- key: Count a record stamped when its `lastMs` falls no earlier than its own first nudge in the window, or no earlier than `sinceMs` for the unnudged group.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: dda9892 2026-08-30, a stamp preceding its nudge had counted as a success; d25d512 2026-09-02 gave the dispatched arm the same floor.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The function's stamped test; instrument-internal.
- proposed: (via A158) Delete from "It splits the project tier's live, nudgeable records" to "is not folded into a zero rate."

### c4.C100
- key: Expect `{since, nudged, dispatched, unnudged}` each with `{total, stamped, rate}`, `rate` `null` rather than `NaN` for an empty group.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: dda9892 2026-08-30; 653faed 2026-09-02 added the dispatched arm.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The return shape, shown by running the command; the arm names a reader needs ride c4.C107 and c4.C108.
- proposed: (via A158) Delete from "It splits the project tier's live, nudgeable records" to "is not folded into a zero rate."

### c4.C101
- key: Expect `{error: <cause>}` on the causes that silence the hook itself plus four the report alone hits, three of them bounds that would shorten one side of the comparison.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: 4200d16 2026-08-30, both truncations made to refuse rather than understate, and the unreadable sidecar distinguished from an absent one.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The function's refusals, each naming its cause; recorded here that all three truncation bounds would have biased the reading toward the feature, which is why they refuse.
- proposed: (via A158) Delete from "It splits the project tier's live, nudgeable records" to "is not folded into a zero rate."

### c4.C102
- key: Run the reading as `node -e` requiring `<plugin-root>/hooks/memory-recognition-nudge.js` and calling `nudgeStampRate(process.cwd(), Date.now() - 7*24*60*60*1000)`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:246
- provenance: 4200d16 2026-08-30.
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: .nudgeStampRate(process.cwd(), Date.now() - 7 * 24 * 60 * 60 * 1000))
- passage: node -e "console.log(require
- ruled: cut 2026-09-30

### c4.C103
- key: Run the command from the project directory the report is about.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:250
- provenance: 4200d16 2026-08-30.
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: Run it from the project directory the report is about.
- ruled: cut 2026-09-30

### c4.C104
- key: Resolve both halves of the join by one rule: the memory tier from `memq`'s resolution of the working directory, the log root from the path-side half of that same resolution.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:250
- provenance: 555407f 2026-09-01, one store derivation for every resolver after independent derivations could disagree about which project a session was in.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Program behavior inside the function (hooks/memory-recognition-nudge.js:2699 through memq's exported resolver); c4.C103 is obeyable without it, and the reason is recorded here: a worktree or subdirectory reads one project's tier and log rather than pairing one project's records with another's log.
- proposed: Delete "The two halves of the join are resolved by one rule ... another's log."

### c4.C105
- key: Spell `<plugin-root>` as `CLAUDE_PLUGIN_ROOT` where the harness supplies it and this skill's base directory's grandparent otherwise, with forward slashes whatever the platform.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:250
- provenance: 4200d16 2026-08-30.
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: `<plugin-root>` is `CLAUDE_PLUGIN_ROOT` where the harness supplies it and this skill's own base directory's grandparent otherwise. Use forward slashes on every platform, since a backslash reads as an escape in a JavaScript string.
- flag: stale
- ruled: cut 2026-09-30

### c4.C106
- key: Do not substitute a relative specifier for `<plugin-root>`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:250
- provenance: 4200d16 2026-08-30.
- verdict: retire
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: Never substitute a relative specifier, which resolves against the working directory and names the hook only from a kit checkout.
- ruled: cut 2026-09-30

### c4.C107
- key: Read `nudged.rate` against `unnudged.rate` rather than either alone.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:252
- provenance: dda9892 2026-08-30, the gate is a comparison of arms, not a rate.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- proposed: Reduce line 252 to: read `nudged.rate` against `unnudged.rate` rather than either alone, since the gate is whether a nudged record is applied more often than one nothing nudged; read `dispatched.rate` beside them rather than folded into either; and read a window spanning a rename knowing the rename is in it, the old name leaving both arms and the new name joining the unnudged arm, which leans against the feature.
- baseline-test: yes
- passage: Read `nudged.rate` against `unnudged.rate` rather than either alone, since the gate is whether a nudged record is applied more often than one nothing nudged.
- ruled: cut 2026-09-30

### c4.C108
- key: Read `dispatched.rate` beside the other two rather than folded into either, as what the dispatch channel is worth on its own evidence.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:252
- provenance: 653faed 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: Read `dispatched.rate` beside them rather than folded into either, as the dispatch channel's own evidence.
- ruled: cut 2026-09-30

### c4.C109
- key: Ask the comparison of the tier as it stands at read time, excluding a record retired or decayed out between the nudge and the reading from both groups.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:252
- provenance: 4200d16 2026-08-30, the nudged arm bounded by the nudgeable set as the control already was.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The function groups from the live listing; the consequence a reader needs is c4.C110's.
- proposed: (via A171) Reduce line 252 to: read `nudged.rate` against `unnudged.rate` rather than either alone, since the gate is whether a nudged record is applied more often than one nothing nudged; read `dispatched.rate` beside them rather than folded into either; and read a window spanning a rename knowing the rename is in it, the old name leaving both arms and the new name joining the unnudged arm, which leans against the feature.

### c4.C110
- key: Read a window spanning a rename knowing the rename is in it, since the old name falls out of both arms and the new name joins the unnudged arm.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:252
- provenance: 4200d16 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: A window spanning a rename leans the reading against the feature, since the old name leaves both arms and the new name joins the unnudged arm.
- ruled: cut 2026-09-30

### c4.C111
- key: Treat a materially higher nudged rate as evidence consistent with the nudge working, never proof, since the nudged group is selected for topical relevance before the comparison starts.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:254
- provenance: dda9892 2026-08-30, the confound disclosed because a gate reading an undisclosed confound is worse than no gate.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- proposed: Reduce line 254 to: a materially higher nudged rate is evidence consistent with the nudge working, never proof, since the nudged group is selected for topical relevance before the comparison starts; decision 2 treats the reading as one input among others.
- baseline-test: yes
- passage: A materially higher nudged rate is evidence consistent with the nudge working, never proof, since the nudged group is selected for topical relevance before the comparison starts.
- ruled: cut 2026-09-30

### c4.C112
- key: Treat this reading as one input among others for decision 2's gate, not a number that alone justifies building the semantic tier.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:254
- provenance: dda9892 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: Decision 2 treats the reading as one input among others.
- ruled: cut 2026-09-30

### c4.C113
- key: Write the trigger line the flag door produces at the frontmatter block's top level when the record is created.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:219
- provenance: 2b6e936 2026-09-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The flag's own placement, stated in row 30.
- proposed: Delete "the flag writes that same line, at the frontmatter block's top level, as the record is born".

### c4.C114
- key: Under the engine store signals, refuse the verb only for a `--replace` targeting a shared tier or a pinned project store, not every write.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:227
- provenance: 9b1180b 2026-09-03, the pinned working directory is shared by everything under it, the same condition the shelves are fenced for.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Row 29 and line 166 state it; enforced at scripts/memq.js:10340 and screened at hooks/memq-grant.js:69-70. Lands with row 29's --replace refusal sentences retired under c1.C061; the fleet paragraph states the shape among the twelve, and memq.js:10340 enforces it.
- proposed: (via A101) Reduce line 227 to the composition rules that survive (C067 and a one-line pointer that `glob:` takes the anchor path grammar with wildcards admitted) and a pointer at row 29 for the refusal list.

### c4.C115
- key: Expect `{error: <cause>}` for an unloadable memq, a network-shaped working directory or store root, or an unresolvable project memory directory, the same causes that silence the hook itself.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: dda9892 2026-08-30; the network stand-down by 555407f 2026-09-01.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The function's error surface, each error naming its cause.
- proposed: (via A158) Delete from "It splits the project tier's live, nudgeable records" to "is not folded into a zero rate."

### c4.C116
- key: Design the semantic (match-by-meaning) tier only once nudging is shown to change behavior at all.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:243
- provenance: dda9892 2026-08-30, restating decision 2 of the memory-recognition plan (docs/archive/claude-kit_memory-recognition_spec_v1.md:29).
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 901 (Nudge log stamp-rate instrument), dropped under the mechanism cut.
- passage: This log is the instrument decision 2 of the archived memory-recognition plan reads before a semantic tier is designed.
- ruled: cut 2026-09-30

### c5.C001
- key: Start a memory's idle clock at the freshest of its file mtime, its `created:` frontmatter date, and its newest `applied` stamp.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:258
- provenance: 8e22ff4 2026-07-31, the memory-extension plan installed the decay lifecycle and defined `created:` as one of the clock's inputs; last reworded 0d1e610 2026-08-30.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: `lastAliveMs` (memq.js:4967) computes the clock, but the pass's judgment step reads every nomination against it, and the plan that installed the formula decided it stay statable verbatim in both code and skill. Retiring the definition would leave the judgment with nothing to check the scan line against. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: A memory's idle clock runs from the freshest of its update time, its created date and its newest `applied` stamp.
- flag: stale

### c5.C002
- key: Never let a `read` stamp reset a memory's idle clock.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:258
- provenance: 8e22ff4 2026-07-31, installed with the clock; last reworded 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The Applied-stamps section at line 94 owns the applied-versus-read distinction and states what read stamps are for; this is its negative half, and the clock's own input list already excludes reads. Safe because the owner keeps the rule whole.
- proposed: (via A004) Drop "`read` stamps never reset the clock." from line 258; the Applied stamps section states it.
- baseline-test: yes

### c5.C003
- key: Treat 30 idle days as the base summarize threshold and 60 idle days as the base archive threshold.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:258
- provenance: f270e9c 2026-07-31, the recall-and-reinforcement plan set the base thresholds; restated in prose at 258 by 8e22ff4 2026-07-31.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The formula block at 263 to 265 carries both base figures as its constants (memq.js:553), so the prose statement is the copy. Safe because the surviving formula states 30 and 60 exactly. Its landing respelled c5.C004's keep sentence; c5.C004 records the flip.
- proposed: (via A007) Reword line 258 so the summarize and archive definitions stand without restating 30 and 60, which the formula block carries.
- baseline-test: yes

### c5.C004
- key: Summarize by condensing the body and keeping the index description; archive by moving the record to the tier's `archive/` and carrying its index line to the archive's index.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:258
- provenance: 8e22ff4 2026-07-31, the memory-extension plan defined both decay operations.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The archive move is `decay-prune`'s, but the summarize is the pass's only hand edit and nothing automates it (finishing-work/SKILL.md:104), so this definition is what the hand edit follows. The summarize hand-edit prescription sits under finishing-work step 8 at plugins/grimoire/skills/finishing-work/SKILL.md:106 at HEAD. Flipped from keep to rewrite at section 22's close: c5.C003's retire removed the restated 30 and 60, so the sentence was respelled to stand as landed. Landed as the proposal below. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: Idle past the thresholds below, it is a summarize candidate (condense the body, keep the index description) and then an archive candidate (move to the tier's `archive/`, index line carried to the archive's own index).
- passage: Summarizing condenses the body and keeps the description. Archiving marks the record archived.

### c5.C005
- key: Expect a summarize edit to reset mtime, so the archive threshold falls 60 idle days plus the extension after the summarize rather than after last application.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:258
- provenance: 8e22ff4 2026-07-31, a consequence of the clock's mtime input, written for a reader who wonders why an archive nomination trails a summarize by a full span.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The consequence now lives here: a summarize edit rewrites the file, so the mtime input restarts and the archive nomination arrives 60 idle days plus the record's extension after the summarize. The pass computes it and the judgment can be made without knowing it.
- proposed: Delete the sentence from line 258; the ledger entry for C005 carries the consequence.

### c5.C006
- key: When retiring a record, move its `<name>.md.bak` backups and any `<name>.md.tmp.<pid>` stranded temp file into `archive/` beside it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:258
- provenance: 752dbce 2026-08-22, the shared-tier authoring plan Section 2, after a `.bak` left beside a retired shared record kept the deleted body readable and syncable.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The pass performs the sweep itself (memq.js:13782, :16399) and no session act depends on knowing it in advance. The why stays here: a retirement that leaves the record's own copies behind leaves the retired text readable and syncing.
- proposed: Delete the retirement-sweep sentence from line 258; the ledger keeps why the sweep exists.

### c5.C007
- key: Leave a copy the pass cannot move in place, name it in the report, and attempt it again on a re-run.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:258
- provenance: 752dbce 2026-08-22, installed with the retirement sweep.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Leaving, naming and retrying are the pass's own (memq.js:16399-16400), and the report names the unmoved copy at the moment it matters. Safe because the run tells the reader more than the prose could.
- proposed: (via A014) Delete the retirement-sweep sentence from line 258; the ledger keeps why the sweep exists.

### c5.C008
- key: Let recorded use extend a memory's decay thresholds, but never treat use as conferring permanence.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:260
- provenance: f270e9c 2026-07-31, the recall-and-reinforcement plan's own thesis for the frequency-extends-decay design.
- verdict: keep
- reason: No finding. It is the rule the formula and the cap serve, and the only sentence that says why nothing here becomes permanent by accumulation.
- passage: Use extends the thresholds, and never confers permanence.

### c5.C009
- key: Push both thresholds out by each distinct calendar day the memory was applied, subject to the cap.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:260
- provenance: f270e9c 2026-07-31, the recall-and-reinforcement plan installed the extension.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The formula block three lines down states the rule exactly with the cap's value, and `distinctDays` is its variable (memq.js:11671). Safe because the surviving formula loses nothing this lead-in carried.
- proposed: (via A016) Reduce line 260 to the bold rule (C008) introducing the formula block; drop "Each distinct calendar day ... capped".
- baseline-test: yes

### c5.C010
- key: Compute extension as min(distinctDays * 30, 365) idle days, summarize after 30 + extension, archive after 60 + extension.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:263
- provenance: f270e9c 2026-07-31, the council's surviving objection to any formula was answered by making it a one-liner statable verbatim in code and skill.
- verdict: keep
- reason: It is the code's own formula by design ("two surfaces, one truth"), so a session reading a tally on a scan line can check the nomination without opening memq. Retiring it would reverse a decided trade rather than remove a copy.
- passage: A memory is a summarize candidate after 30 idle days and an archive candidate after 60, each extended by 30 per distinct applied day, the extension capped at 365.

### c5.C011
- key: Read the formula as buying 180 extra idle days for six days of use, with the cap first binding at thirteen distinct days.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:268
- provenance: f270e9c 2026-07-31, worked figures written beside the formula.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The figures are what the surviving formula produces, and the acceptance numbers live in the archived plan's Section 3. Nothing a session does turns on the illustration.
- proposed: Delete the "six days buys 180" sentence from line 268.

### c5.C012
- key: Treat both threshold tests as inclusive, so the most extended memory is a summarize candidate at 395 and an archive candidate at 425 idle days.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:268
- provenance: f270e9c 2026-07-31; the boundaries were verified at 210/209 and 395 in the plan's Chapter 3.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Inclusivity and the two figures are how the scan compares (memq.js:11671 onward) and are pinned by the plan's acceptance tests. Recorded here: both tests are inclusive, so the cap-bound memory nominates at 395 and 425 idle days.
- proposed: Delete the "Both tests are inclusive" sentence from line 268.

### c5.C013
- key: Keep the extension linear with a cap rather than doubling, because a multiplier reaches effective permanence within a few reinforcements.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:268
- provenance: f270e9c 2026-07-31, decided on the operator's explicit call, revising the council's converged pin-primary design.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The design defence of linear-with-cap over doubling belongs here and in the archived plan; the formula stands without it. A session proposing a multiplier should read this entry first: doubling reaches effective permanence within a handful of reinforcements, which c5.C008 bars.
- proposed: Delete the "Linear with a cap, not doubling" sentence; the ledger entry for C013 carries the decision.

### c5.C014
- key: Count distinct days rather than raw stamp counts, so one busy afternoon counts as one reinforcement.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:268
- provenance: f270e9c 2026-07-31, installed with the formula's `distinctDays` term.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The counting is `appliedTally`'s (memq.js:2613-2669) and the formula's own variable names it; the "busy afternoon" gloss is rationale for it. Safe because the surviving formula still says `distinctDays`.
- proposed: Delete the "Distinct days, not raw counts" sentence from line 268.

### c5.C015
- key: Treat crossing a decay threshold as nominating a memory, never as retiring it.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:270
- provenance: f270e9c 2026-07-31, the plan's Approach: "crossing a threshold only nominates".
- verdict: keep
- reason: Nothing mechanically stops a session from treating a scan line as a verdict, and the whole pass is built around a judgment step between scan and prune. The drift-line bar at 207 shares the principle without stating this subject.
- passage: Crossing a threshold nominates and never retires.

### c5.C016
- key: Read the tally `applied <date> (<n>d distinct)` off the scan line when judging a nomination.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:270
- provenance: f270e9c 2026-07-31, the tally was put on the scan line precisely so the judgment is never blind.
- verdict: retire
- reason: row 902 (Decay threshold formula) shrink. The scan line prints the tally, and "Crossing a threshold nominates and never retires." carries the judgment act.
- passage: The scan line carries the tally (`applied <date> (<n>d distinct)`), so judge each nomination against it.
- flag: stale

### c5.C017
- key: Nominate a superseded record as an archive candidate regardless of its idle clock.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:272
- provenance: b5c0a98 2026-08-23, the memory-supersedes plan Section 1: "decay-scan lists the record as an archive candidate naming the pointer as evidence, pinned records excepted".
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 903 (Superseded candidates and neighbour floors), dropped under the mechanism cut.
- proposed: (via A027) Rewrite paragraph 272 to: nominate a superseded record for archive whatever its idle clock, the pointer riding the scan line as evidence; a pin outranks the nomination and the pinned line still carries the pointer; a tier whose usage sidecar was not read whole nominates nothing, per the evidence-line section.
- baseline-test: yes
- passage: **A superseded record is an archive candidate whatever its idle clock**, the pointer riding the scan line as the evidence.
- flag: stale
- ruled: cut 2026-09-30

### c5.C018
- key: Carry the supersession pointer on the scan line as the evidence for the nomination.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:272
- provenance: b5c0a98 2026-08-23, installed with the nomination rule.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The scan carries the pointer on the line itself (memq.js:11701, `supersededHere`), and the clause survives inside the rewritten rule's first sentence rather than as its own claim.
- proposed: Fold into A027's first sentence.

### c5.C019
- key: Short-circuit a superseded record past both threshold tests and the summarize rung straight to an archive nomination.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:272
- provenance: b5c0a98 2026-08-23.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The short circuit runs in the scan before the threshold compare (memq.js:11700-11722); a session sees an archive line and judges it. The why is here: a pointer says the store already holds a newer answer, so the summarize rung has nothing to preserve.
- proposed: Delete the "Archive rather than summarize: the pointer short-circuits" sentence.

### c5.C020
- key: Do not let the applied-day extension hold back a superseded record's nomination.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:272
- provenance: b5c0a98 2026-08-23.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The extension sits inside the clock the scan ignores for a superseded record (memq.js:11702-11705), and "whatever its idle clock" in the surviving rule already carries the case.
- proposed: Delete "The applied-day extension does not hold it back ..." from 272.

### c5.C021
- key: Let a pin outrank a supersession nomination, and still carry the pointer on the pinned line as evidence.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:272
- provenance: b5c0a98 2026-08-23, the pin exception was stated with the nomination rule from the start.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 903 (Superseded candidates and neighbour floors), dropped under the mechanism cut.
- passage: A pin outranks the nomination, and the pinned line still carries the pointer.
- ruled: cut 2026-09-30

### c5.C022
- key: Nominate nothing at all, pointer included, in a tier whose usage sidecar could not be read.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:272
- provenance: b5c0a98 2026-08-23, tightened by ad7b109 2026-08-25 when the suppression gained its skipped-line grain.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 903 (Superseded candidates and neighbour floors), dropped under the mechanism cut.
- proposed: (via A033) The rewritten rule says "a tier whose usage sidecar was not read whole nominates nothing, per the evidence-line section" and states no more.
- baseline-test: yes
- passage: A tier whose usage sidecar was not read whole, the file unreadable or a line torn inside it, nominates nothing, pointer included; the evidence line reports the partial read.
- ruled: cut 2026-09-30

### c5.C023
- key: Keep supersession a nomination rather than a retirement because the pointer is hand- or model-written data and a wrong one must cost a mislabel, not a fact.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:272
- provenance: b5c0a98 2026-08-23, the plan's Section 3: the read surfaces are built to survive a bad pointer.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The rule is stated at the paragraph's head and is obeyable without its defence. Kept here for anyone proposing to make supersession retire automatically: the pointer is unvalidated hand- or model-written data, so a wrong one must cost a mislabel rather than a fact.
- proposed: Delete the closing "Nomination and never retirement" sentence.

### c5.C024
- key: Tune the decay numbers and `NEIGHBOUR_FLOOR` only at a decay pass that has real evidence.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:274
- provenance: f270e9c 2026-07-31, the plan's Approach: "The seeds are invented, not calibrated"; `NEIGHBOUR_FLOOR` joined the sentence at a3d8fbf 2026-09-06; `NEIGHBOUR_FLOOR` was removed on 2026-10-04 by the finishing pass of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, leaving `FLEET_NEIGHBOUR_FLOOR`.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 903 (Superseded candidates and neighbour floors), dropped under the mechanism cut. The local constant the key names no longer exists: `FLEET_NEIGHBOUR_FLOOR`, measured on the host's embedding model, is the one floor the neighbours and neighbour-pairs blocks read.
- proposed: (via A036) "These numbers and `NEIGHBOUR_FLOOR` are seeds backed by no tally from this store; tune them only on evidence a decay pass has produced."
- baseline-test: yes
- passage: `NEIGHBOUR_FLOOR` is the similarity at which the authoring verbs' neighbours block and the scan's neighbour-pairs block read two records as one fact. These numbers, `NEIGHBOUR_FLOOR` and `FLEET_NEIGHBOUR_FLOOR`, are seeds backed by no tally from this store.
- passage: Tune them only on evidence a decay pass has produced.
- ruled: cut 2026-09-30

### c5.C025
- key: Do not widen the decay numbers or `NEIGHBOUR_FLOOR` speculatively.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:274
- provenance: f270e9c 2026-07-31, written as the second half of c5.C024's sentence.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Tuning only on evidence a decay pass produced already bars widening without evidence, so the bar retires into c5.C024's merged clause and no instruction is lost.

### c5.C026
- key: Treat a `pinned: YYYY-MM-DD` frontmatter line as making a memory never a summarize or archive candidate and making `decay-prune` refuse it by name.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:278
- provenance: f270e9c 2026-07-31 installed the pin; ae2c70a 2026-08-22 narrowed its bound after a whole-file read found the skill implying a pin bound the delete verbs.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: This is the field's definition, and the rules that set, revoke and bound a pin are meaningless without it. The exemption and the refusal are program behaviour (memq.js:11696, :13637, :14083), but no program tells an author what the field is. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: A pin makes a memory never a decay candidate, and makes `decay-prune` refuse it.
- flag: stale

### c5.C027
- key: Write the `pinned:` field at the top level of the frontmatter block.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:278
- provenance: eecf17c 2026-08-23, after the harness was found rewriting hand-written frontmatter under a `metadata:` map.
- verdict: retire
- landed: f92e99ec section 5
- reason: The grammar paragraph at 284 owns the placement rule for the pin, with the scan naming a misplacement; this sentence becomes a pointer at it. Safe because the owner states placement and its failure mode in full. Lands as 'Write it at the top level like every other field here.', a pointer at the placement rule rather than at the grammar rules, the placement rule owning both placements. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: (via A041) Replace "Write it at the top level; it pins there and under the `metadata:` map the harness moves it to." with a pointer at the grammar rules below.
- baseline-test: yes
- passage: A `pinned: YYYY-MM-DD` top-level line makes a memory never a decay candidate, and makes `decay-prune` refuse it.

### c5.C028
- key: Treat the presence of the `pinned:` field as the pin; its date is never parsed.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:278
- provenance: f270e9c 2026-07-31, installed with the pin.
- verdict: retire
- reason: row 904 (Pinning against decay) shrink. "Revoke it by deleting the line." carries the act that presence is the pin.
- passage: The field's presence is the pin, and the date only records when the judgment was made.
- flag: stale

### c5.C029
- key: Treat a pin as a judgment act, using the applied tally as evidence for it and never as its trigger.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:280
- provenance: f270e9c 2026-07-31; the council rejected computed consolidation as keyed to a signal with no data-generating process. Last touched 70f4f8b 2026-08-02.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule holds and nothing enforces it. Only the paragraph compresses: the automatic-grant bar (c5.C030) folds into "never its trigger", and the argument that a count is a signal with no owner moves here.
- proposed: (via A045) Paragraph 280 becomes: the pin is a judgment act and the tally is evidence for it, never its trigger; set one in the turn a memory proves structurally load-bearing or at a decay pass on a candidate that must not age out; the case it exists for is a memory recognized from an index already in context, which no stamp sees.
- baseline-test: yes
- passage: **A pin is a judgment act, and the tally is evidence for it, never its trigger.**

### c5.C030
- key: Never grant a pin automatically from a high applied count.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:280
- provenance: f270e9c 2026-07-31, written as the same sentence's second clause.
- verdict: retire
- landed: d2c43f1 section 22
- reason: "Never its trigger" in c5.C029 already carries the bar, so the restatement retires into it with no loss.

### c5.C031
- key: Set a pin in the turn a memory proves structurally load-bearing, or at a decay pass on a candidate you know must not age out.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:280
- provenance: f270e9c 2026-07-31, installed with the pin as the two moments a pin is set.
- verdict: retire
- landed: f92e99ec section 5
- reason: This section owns when a pin is set; the Known-limits bullet at 312 becomes a pointer at it. No machinery sets or proposes a pin. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: Set one in the turn a memory proves structurally load-bearing, or at a decay pass on a candidate that must not age out.

### c5.C032
- key: Pin for systematic under-reporting, where a memory recognized from an index already in context passes neither reader and its stamps undercount its use.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:280
- provenance: f270e9c 2026-07-31, the plan's Approach: the field exists for the structural under-reporting case.
- verdict: retire
- reason: row 904 (Pinning against decay) shrink. This is rationale only, and c5.C031's landed sentence carries the act.
- passage: It exists for systematic under-reporting. A memory recognized from an index already in context passes neither reader, so its stamps undercount exactly the most ambient memories.

### c5.C033
- key: Revoke a pin by deleting the `pinned:` line; there is no override flag.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: ae2c70a 2026-08-22, the whole-file read against the shipped CLI, after a session reached for a delete verb to clear a pin.
- verdict: retire
- landed: f92e99ec section 5
- reason: Deleting the line is a hand edit no verb performs; no `pinState` call site in memq is a writer. The incident recurs whenever a session looks for a flag that does not exist. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: Revoke it by deleting the line.

### c5.C034
- key: Expect no memq write path to emit a `pinned:` field and no path to remove one, in any tier.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: ae2c70a 2026-08-22.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: An absence of a code path is not something a program enforces, and this absence is the premise the shared-tier pin rules (c5.C035, c5.C036) rest on. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: No memq verb sets or clears a pin, so a record holds one only where its memory file carried a `pinned:` line at the migration publish, and `--replace` keeps it.

### c5.C035
- key: Add or remove a shared-tier pin outside the harness, in an editor or the store's own checkout.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: 426bf68 2026-08-26, the anchors-and-guard plan's Standing Amendment restated the hand-edit exception after the guard began refusing the tools that would make it.
- verdict: retire
- landed: f92e99ec section 5
- reason: The guard forces the route (hooks/memory-frontmatter-guard.js:14-17, :90-91) and the edit itself is the operator's; nothing enforces where they make it. The apparent conflict with the CLI-authored rule is not real at execution time, because no session performs this act. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: So a shared-tier pin is the operator's own edit made outside the harness, since the frontmatter guard refuses the write tools there.

### c5.C036
- key: Treat the operator's own `pinned:` edit as the one exception to the bar on hand-editing a shared tier.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: 426bf68 2026-08-26 (Standing Amendment); the exception itself dates to ae2c70a 2026-08-22.
- verdict: retire
- landed: f92e99ec section 5
- reason: The exception holds by necessity, since no authoring path serializes a `pinned:` field under the tier lock, and the operator gate on the act guards blast radius: a hand edit of a tier every project and machine reads, with no validation path. Only the paragraph compresses around it. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: Compress 282 to: revoke by deleting the line, there being no override flag; no memq path writes or removes the field, so a shared-tier pin is the operator's own edit outside the harness, the one exception to the hand-edit bar; do not use `delete-type` or `delete-operator` to clear one (they do not refuse a pinned record, so a pinned shared record is removable, at the cost of its stamps); a pin binds the decay pass and nothing else.
- baseline-test: yes
- passage: That edit is the one exception to the bar on hand-editing a shared tier.

### c5.C037
- key: Do not use `delete-type` or `delete-operator` to clear a pin.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: ae2c70a 2026-08-22, installed with the revocation rule after the wrong route was reached for.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The bar survives in the compressed paragraph; the route it forbids is not implied by the route c5.C033 gives, so it stays a rule. Its two costs move to this ledger (c5.C038).
- passage: A pin binds the decay pass and nothing else: the delete verbs still remove a pinned record, so never use a delete verb to clear a pin.

### c5.C038
- key: Avoid the delete because it drops the record's usage stamps, zeroing the applied tally and its extension, and meets another machine's copy as a modify/delete conflict that stalls sync.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: ae2c70a 2026-08-22, which also recorded that the sidecars merge by union and cannot express a removal.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The bar (c5.C037) is obeyable without its costs, and finishing-work step 7 carries them too. Recorded here: clearing a pin by delete loses the record's usage stamps, so a rewritten record starts with a zero tally and none of its earned extension, and it meets another machine's copy as a modify/delete conflict that stalls sync both ways. At HEAD finishing-work step 8 names the pin's hand removal and points here; the costs are recorded in this entry alone. Its landing respelled c5.C039's keep sentence; c5.C039 records the flip.
- proposed: Delete the costs clause; keep the bar (A058).

### c5.C039
- key: Expect the delete verbs not to refuse a pinned record, so a pinned shared record is not removable by no path at all.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: ae2c70a 2026-08-22; the trade was settled by a consult recorded in the anchors-and-guard plan (docs/archive/claude-kit_memory-anchors-and-frontmatter-guard_spec_v1.md:319).
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: No code enforces an absence: the delete verbs simply carry no pin check (memq.js:16417, :16522). The sentence is what tells a session a pinned shared record is removable at a cost, which is the fact the consult needed. Flipped from keep to rewrite at section 22's close: c5.C038's retire dropped the costs its 'that reason' pointed at, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The delete verbs deliberately do not refuse a pinned record, since refusing there would leave a pinned shared record removable by no path at all.
- passage: A pin binds the decay pass and nothing else: the delete verbs still remove a pinned record, so never use a delete verb to clear a pin.
- flag: stale

### c5.C040
- key: Read a pin as binding the decay pass and nothing else.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: ae2c70a 2026-08-22, the corrective bound written after the whole-file read found the skill implying a pin bound the delete verbs.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The bound survives as the closing clause of the compressed paragraph; it is the correction of a real misreading and no program states it.
- passage: A pin binds the decay pass and nothing else: the delete verbs still remove a pinned record, so never use a delete verb to clear a pin.

### c5.C041
- key: Expect every scan to count the whole pinned population and list the first ten with a counted remainder.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:282
- provenance: ae2c70a 2026-08-22; the listing is `PINNED_SHOWN` (memq.js:12595-12615).
- verdict: retire
- landed: d2c43f1 section 22
- reason: The count and the capped listing print on every run that finds a pin, and the output speaks for itself. The why is here: an exemption nobody reviews outlives its truth, so the scan keeps the whole pinned population visible even once it outgrows the listing.
- proposed: Delete the "Every scan counts the whole pinned population" sentence.

### c5.C042
- key: Write `pinned:` at the top level of the frontmatter, never under a key other than `metadata:`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:284
- provenance: eecf17c 2026-08-23, the harness-shape plan Section 1, after the harness was found relocating hand-written fields under `metadata:`; last touched c0a1388 2026-08-26.
- verdict: retire
- landed: f92e99ec section 5
- reason: The four grammar rules (c5.C042 to c5.C045) survive as rules, because the scan enforces them only by naming a misplacement rather than refusing. The paragraph compresses around them, with a pointer at the general placement rule at line 116. 'K07 B350's shape' is not in the tree, so the entry lands as three enforced rules (placement per the placement rule above, the closing fence, the 40-line bound) in one paragraph, with the 32-line budget as its own sentence after them, since the scan enforces the 40-line bound (memq.js FRONTMATTER_MAX_LINES) and not the budget. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: Compress 284 to the four rules in K07 B350's shape, with a pointer at line 116 for the general placement rule.
- baseline-test: yes
- passage: A `pinned: YYYY-MM-DD` top-level line makes a memory never a decay candidate, and makes `decay-prune` refuse it.

### c5.C043
- key: Close the frontmatter block with its `---` fence.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:284
- provenance: eecf17c 2026-08-23, one of the three frontmatter-walk properties the pin makes load-bearing.
- verdict: retire
- landed: f92e99ec section 5
- reason: The rule survives in the compressed grammar paragraph; an unfenced block still pins nothing and nothing refuses it, so the rule is what a hand-written record depends on. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- passage: The frontmatter block must close with its `---` within the first 40 lines.

### c5.C044
- key: Keep the closing frontmatter fence within the file's first 40 lines.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:284
- provenance: eecf17c 2026-08-23, the frontmatter read cap made load-bearing by the pin.
- verdict: retire
- landed: f92e99ec section 5
- reason: The rule survives in the compressed paragraph. Its consequence (c5.C046) leaves, because the scan now reports an overrun as `not classified` and names the repair (memq.js:11616-11617). Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- passage: The frontmatter block must close with its `---` within the first 40 lines.
- flag: stale

### c5.C045
- key: Budget 32 lines for a hand-written frontmatter block rather than counting a particular record's header.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:284
- provenance: eecf17c 2026-08-23; the harness's own line spend is recorded in the operator memory `claude-code-rewrites-memory-frontmatter-into-metadata`.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 904 (Pinning against decay) shrink. The line budget shrinks to the 40-line clause in c5.C043's landed sentence.
- passage: A hand-written block budgets 32 lines, since the harness's own lines share that bound and may grow by one at any version.

### c5.C046
- key: Expect overrunning the 40-line bound to lose the whole frontmatter block at once, a `pinned:` on its fourth line included.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:284
- provenance: eecf17c 2026-08-23, written when the loss was silent.
- verdict: retire
- landed: d2c43f1 section 22
- reason: c5.C044 is obeyable without knowing the loss is total, and the silence the sentence warned of is gone: the scan reports an overrunning record as `not classified` and names the repair. Recorded here: the overrun loses the whole block at once rather than the lines past the cap.
- proposed: Delete "Overrunning it is not a partial loss ..." from 284.

### c5.C047
- key: Expect the scan to report an overrunning record as `not classified` and to name the repair its tier admits.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:284
- provenance: eecf17c 2026-08-23; the report is memq.js:11598, :11616-11617.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The report is the scan's own and names the repair on the line where it matters, so the prose adds nothing before the run.
- proposed: Delete the "The scan does not stay silent about it" sentence.

### c5.C048
- key: Expect every `decay-scan` to print a standing usage-evidence line per tier, giving stamp and file counts or `none` with the reason.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:288
- provenance: f270e9c 2026-07-31, the facilitator finding of 2026-07-30: "Evidence absence is loud, never silent". Last touched 5ac33f5 2026-08-26.
- verdict: keep
- reason: The scan prints the line unconditionally (memq.js:11770), but the reading rules that follow (c5.C049, c5.C050) cannot name a line the skill never introduces, and the incident recurs whenever a sidecar goes missing.
- passage: and a standing usage-evidence line.

### c5.C049
- key: Read the usage-evidence line on stderr alongside the candidates rather than expecting it in captured stdout.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:288
- provenance: f270e9c 2026-07-31, installed with the evidence line.
- verdict: rewrite
- landed: 227ba108 section 5
- reason: The rule holds, since a session that captures stdout alone never sees the line and nothing warns it. Only the paragraph splits, so the two reading rules lead and the torn-line exit follows. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: Split 288 into the evidence line and its reading (C048 to C050) and the torn-line exit with its two caller-facing bounds (C052 to C054).
- baseline-test: yes
- passage: Every `decay-scan` prints a usage-evidence line on stderr naming the memory database's last-read, last-applied and distinct-day aggregates, the evidence the candidates on stdout rest on.

### c5.C050
- key: Investigate rather than archive when `usage evidence: none (no usage.jsonl)` appears on a store you know has been used.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:288
- provenance: f270e9c 2026-07-31, installed with the evidence line for the lost-sidecar case.
- verdict: retire
- landed: 227ba108 section 5
- reason: A lost sidecar makes every memory read as never-applied, so an unexamined pass would archive the store's most-used records. Nothing detects the loss for the reader; the line reports it and the judgment is the session's. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: `usage evidence: none (no usage.jsonl)` on a store you know has been used means the sidecar is gone, so investigate rather than archive.

### c5.C051
- key: Suppress a tier's candidates entirely when its usage sidecar was not read whole, and count the skipped lines on the evidence line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:288
- provenance: ad7b109 2026-08-25, which added the skipped-line grain after two scans were found calling a gap an absence.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Suppression and the skipped-line count are the scan's (memq.js:11713-11722, `evidenceUnread`) and the evidence line reports them on the run where they happen. The why is here: a torn applied append is exactly where applied evidence hides, so a partial read must nominate nothing rather than nominate on less.
- proposed: Delete the suppression sentence; the evidence line reports it.

### c5.C052
- key: Remove a torn sidecar line only with `decay-prune --rollup --drop-malformed`, which states per-tier counts on stderr before removing, names each removed line, and counts removals in the report.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:288
- provenance: ad7b109 2026-08-25: "decay-prune --drop-malformed is the sanctioned exit; preserving stays the default".
- verdict: rewrite
- landed: 227ba108 section 5
- reason: The rule survives, because a session facing a torn line needs to know there is one exit and that preserving is the default. The report narration (per-tier counts, each line named, removals counted) retires to the verb, which prints it (memq.js:13198-13272). Lands with a defining clause for the torn line (one the scan skipped as malformed inside a sidecar) ahead of the exit, since c5.C051's retire removed the sentence that defined it. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: (via A071) "A torn line has one sanctioned exit, `decay-prune --rollup --drop-malformed`; preserving stays the default." with the report description dropped.
- baseline-test: yes
- passage: A torn line in a frozen usage sidecar has one exit, `decay-prune --rollup --drop-malformed`.
- flag: stale

### c5.C053
- key: Treat `--drop-malformed` as invocation-wide, removing malformed lines from the type and operator tiers as well as the reporting tier.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:288
- provenance: 5ac33f5 2026-08-25, after the security lens found the flag could empty a tier.
- verdict: keep
- reason: The reach is the flag's (memq.js:13536), but a session shapes the call before the verb can tell it, and one flag drops lines in tiers other than the one that reported the skip.
- passage: That flag is invocation-wide, so it drops malformed lines from every tier the pass reaches.
- flag: stale

### c5.C054
- key: Treat the drop as local hygiene only, since sidecars merge by union and a dropped line another machine carries returns at the next merge.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:288
- provenance: ae2c70a 2026-08-22 recorded that the sidecars merge by union and cannot express a removal; carried to the drop at 5ac33f5 2026-08-25.
- verdict: retire
- reason: row 905 (Scan evidence line reading) shrink. The union-merge caveat is detail, and c3.C032's deletion paragraph carries the not-a-redaction rule.
- passage: The drop is local hygiene rather than a redaction, the delete verbs' own caveat. Sidecars merge by union across sync, so a dropped line another machine still carries returns at the next merge, and the shared tiers' private remote keeps the bytes in its history.

### c5.C055
- key: Expect the drop to refuse any tier where no valid stamp would survive, naming the refusal on stderr, leaving that file byte-unchanged, and proceeding with the rest of the pass.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:288
- provenance: 5ac33f5 2026-08-25, the refusal added so the exit could not empty a tier.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The refusal is the verb's, named on stderr with the file byte-unchanged (memq.js:13260-13272). The why is here: a wholly unparseable sidecar is evidence to investigate rather than a file to empty.
- proposed: Delete the "it refuses any tier where no valid stamp would survive" sentence.

### c5.C056
- key: Treat journal entries older than 30 days as rollup candidates that `decay-prune --rollup` folds into one per-key entry preserving the pass/fail tally and the union of tags.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:292
- provenance: 8e22ff4 2026-07-31, the memory-extension plan's Chapter 3 rollup contract fix; last touched ad7b109 2026-08-25.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The fold, the tally, the tag union and the refusal to re-flag its own rollups are all the verb's (memq.js:13116-13160), and the verb table row at line 35 states what `--rollup` runs, which is what a session shaping a call needs.
- proposed: Delete the journal-rollup description from 292; the row at 35 carries the flag's scope.

### c5.C057
- key: Expect `--rollup` to fold each memory's `applied` stamps into one per-file record carrying distinct-day count and first and last application, and to prune `read` stamps to the newest per file.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:292
- provenance: f270e9c 2026-07-31, the plan's Approach: "The usage prune preserves the evidence the formula reads".
- verdict: retire
- landed: d2c43f1 section 22
- reason: The fold and the prune are the verb's (memq.js:13316). The design reason stays here: the prune keeps the distinct-day evidence the extension formula reads, so a rollup never shortens a memory's earned extension.
- proposed: (via A077) Delete the journal-rollup description from 292; the row at 35 carries the flag's scope.

### c5.C058
- key: Pass `--drop-malformed` only alongside `--rollup`; it is an argument error without it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:292
- provenance: ad7b109 2026-08-25, installed with the flag.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The coupling is enforced at parse time with its own message (memq.js:14259-14262), and the skill states it at 35 and again at 288 where the exit names the flag pair.
- proposed: (via A079) Delete "which rides `--rollup` and is an argument error without it" from 292.

### c5.C059
- key: Expect the rollup and usage prunes to run only under `--rollup`; an archive flag alone moves what it names and touches nothing else.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:292
- provenance: 8e22ff4 2026-07-31; the split-call discipline that reads it dates to 752dbce 2026-08-22.
- verdict: keep
- reason: Flag scope is the verb's (memq.js:14171-14184), but the session must know it before the call, since the rules about which call carries `--rollup` are built on it and the verb can only tell it afterwards.
- passage: The pass's one mutation path over the store's own records and sidecars, and it mutates only what its flags name. `--rollup` runs the journal rollup and the usage prunes.
- passage: The rollup and the usage prunes run only under `--rollup`. An archive flag alone moves what it names and touches nothing else.
- flag: stale

### c5.C060
- key: Treat `created: YYYY-MM-DD` as an author-asserted sign of life that can defer decay but never age a memory faster than its mtime.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:294
- provenance: 8e22ff4 2026-07-31, the memory-extension plan's Chapter 3: the implementer defined `created:` as a scan input, and the plan required it be documented or it ships as dead code.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The clock takes the field (memq.js:4967), but this is the field's only definition, and an author deciding whether to write `created:` needs both what it does and what it cannot do. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: A record's created date is a sign of life too. The clock takes the freshest evidence, so it never ages a memory faster than its update time.
- flag: stale

### c5.C061
- key: Write `created:` at the top level of the frontmatter.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:294
- provenance: eecf17c 2026-08-23, the harness-shape plan Section 1.
- verdict: retire
- landed: f92e99ec section 5
- reason: Line 116 owns placement for every field and this sentence says so itself; the restated bound is the copy and goes, the instruction stays as one clause. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was rewrite.
- proposed: (via A086) Reduce to "Write it at the top level like every other field here." with no restated bound.
- baseline-test: yes
- passage: Write it at the top level like every other field here.

### c5.C062
- key: Read finishing-work step 7 for the decay pass trigger and run, since it owns them.
- class: pointer
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 8e22ff4 2026-07-31, which had finishing-work step 7 run the scan when the decay stamp is older than 14 days; last touched ae2c70a 2026-08-22.
- verdict: retire
- superseded-by: S005
- reason: The ownership map assigns decay to memory-system with finishing-work calling it, while this sentence says the reverse and finishing-work points back here for the exact condition. Two owners cross-pointing is the defect the map names; the rewrite makes this section the owner and step 7 the caller. Superseded at `4b2e64c` by S005 (the Section 8 merge; the verdict before it was rewrite).

### c5.C063
- key: Treat a decay stamp older than 14 days, or absent, as due for a pass.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 8e22ff4 2026-07-31; the "absent is due" clause was a review fix for a backstop inert on exactly its target population, a store that has never run a close-out.
- verdict: retire
- superseded-by: S006
- reason: Nothing in memq starts a pass; the 14-day predicate is a reading of the stamp the close-out performs, and the never-run case is the one the fix exists for. Superseded at `4b2e64c` by S006 (the Section 8 merge; the verdict before it was keep).

### c5.C064
- key: Run the pass in order: `decay-scan` reports, your judgment picks, `decay-prune --rollup` with archive flags mutates, `decay-done` stamps.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 8e22ff4 2026-07-31, the plan's Approach: decay is deterministically scanned, human-judged and close-out-triggered.
- verdict: retire
- superseded-by: S007
- reason: The verbs report, mutate and stamp, but no driver runs them in order and the judgment step between them is the session's. Superseded at `4b2e64c` by S007 (the Section 8 merge; the verdict before it was keep).

### c5.C065
- key: Hand-edit only a project-tier summarize; summarize a shared-tier candidate through `add-type` or `add-operator` with `--update`, a body flag and `--confirm-shared`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, the whole-file read that found finishing-work prescribing two hand edits the shared tiers bar.
- verdict: retire
- superseded-by: S008
- reason: The routing rule holds, because the summarize is the pass's only hand edit and the shared tiers refuse it. Only the wording compresses with the paragraph, in the order the calls are made. Superseded at `4b2e64c` by S008 (the Section 8 merge; the verdict before it was rewrite).

### c5.C066
- key: Treat `--confirm-shared` as one flag for the whole invocation rather than one per target.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22: the flag is consumed by two independent gates.
- verdict: retire
- superseded-by: S010
- reason: The flag's scope is the CLI's (memq.js:14238, :14268), but it is the fact every split-call rule follows from, and the verb tells a session only after it has silently waived the type tier's gate. Superseded at `4b2e64c` by S010 (the Section 8 merge; the verdict before it was keep).

### c5.C067
- key: Supply `--confirm-shared` for every `--archive-operator`, the operator tier having no unshared case.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; the pass was designed at 8e22ff4 2026-07-31 as a close-out act made where the operator is near.
- verdict: retire
- superseded-by: S011
- reason: The requirement is a check in the verb (memq.js:14194-14195), but its point is the call shape: an unconditional gate earns its own call. The flag is the CLI's consent token rather than the operator's confirmation, and the archive it consents to is a demotion the store still serves, so the doctrine's irreversible bar does not bite. Superseded at `4b2e64c` by S011 (the Section 8 merge; the verdict before it was keep).

### c5.C068
- key: Rely on the target check, which refuses the whole pass naming the memory it could not find, to catch a mistyped name.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22.
- verdict: retire
- superseded-by: S012
- reason: The target check refuses the whole pass and names the memory (memq.js:14082-14124), so the sentence is reassurance about a failure the run reports itself. Superseded at `4b2e64c` by S012 (the Section 8 merge).

### c5.C069
- key: Give any operator-tier archive its own `decay-prune` call and run the type-tier archive in a separate call without the flag.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, the whole-file read that found one boolean serving two gates.
- verdict: retire
- superseded-by: S014
- reason: The rule holds and nothing enforces it: the security model records the split as prose-enforced with no mechanical check, and combining the calls waives the type tier's cross-project gate silently. Only the paragraph's wording and order change. Superseded at `4b2e64c` by S014 (the Section 8 merge; the verdict before it was rewrite).

### c5.C070
- key: Put `--rollup` on exactly one call, the project tier's.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, installed with the split-call discipline.
- verdict: retire
- superseded-by: S015
- reason: The rule holds unenforced: a second rollup can rewrite a sidecar a lock-free stamp touched since the first and spend the file's only backup generation on the already-pruned copy. Wording compresses with the paragraph. Superseded at `4b2e64c` by S015 (the Section 8 merge; the verdict before it was rewrite).

### c5.C071
- key: Add `--confirm-shared` to the type-tier call only after the refusal has named the projects the retirement would reach.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22.
- verdict: retire
- superseded-by: S017
- reason: The rule holds: the refusal is the only surface that names the reach, and the flag once passed waives the gate for the whole invocation. Wording compresses with the paragraph. Superseded at `4b2e64c` by S017 (the Section 8 merge; the verdict before it was rewrite).

### c5.C072
- key: Ask the operator rather than adding the flag when the refusal reports that the scan of declaring projects could not be established.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; `projectsDeclaringType` answers null with "could not scan ... for declaring projects" (memq.js:13866-13882).
- verdict: retire
- superseded-by: S018
- reason: The operator gate stands and guards blast radius: a type-tier retirement reaches every declaring project on every synced machine, and confirming past an unestablished scan buys exactly the retirement the gate asks about. Where line 35's row reads as telling a session to pass the flag in that state, this rule is the one history backs and the row gives way. Superseded at `4b2e64c` by S018 (the Section 8 merge; the verdict before it was keep).

### c5.C073
- key: Expect a pass that needed `--confirm-shared` and omitted it to refuse having changed nothing, so a retry costs a round and no work.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; the verb acquires every lock before anything mutates (memq.js:14196-14200).
- verdict: retire
- superseded-by: S020
- reason: The split rule is obeyable without the reassurance, which restates the verb's validate-before-mutate posture. Recorded here: a refused pass changes nothing, so the cost of splitting a call wrongly is one round. Superseded at `4b2e64c` by S020 (the Section 8 merge).

### c5.C074
- key: Under the engine store, archive what the pass names and leave the journal rollup to an attended session.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 752dbce 2026-08-22, the shared-tier plan's grant list ("Six shapes get no prompt-free allow"); the denylist gained `--drop-malformed` at 5ac33f5 2026-08-25.
- verdict: retire
- superseded-by: S021
- reason: The gate guards an irreversible act and stays: a rollup rewrites every tier's sidecar and journal under a single `.bak` that never syncs, so on an unattended worker it is as final as a deletion. `hooks/memq-grant.js` withholds the flag mechanically; this sentence tells the pass what to do instead. Superseded at `4b2e64c` by S021 (the Section 8 merge; the verdict before it was keep).

### c5.C075
- key: Expect the SessionStart hook to nudge when the decay stamp is 30+ days overdue.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 8e22ff4 2026-07-31, the SessionStart backstop.
- verdict: retire
- superseded-by: S022
- reason: The nudge is emitted by `hooks/memory-session.js` (`NUDGE_AFTER_DAYS = 30`, `decayNudge`, :213, :352-390) and names the pass itself when it fires. Superseded at `4b2e64c` by S022 (the Section 8 merge).

### c5.C076
- key: Do not run `decay-prune` unprompted outside a close-out.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; the pass was designed at 8e22ff4 2026-07-31 as a close-out act made where a human is near.
- verdict: retire
- superseded-by: S023
- reason: The bar holds and nothing enforces it on an attended session. Only the wording compresses with the paragraph. Superseded at `4b2e64c` by S023 (the Section 8 merge; the verdict before it was rewrite).

### c5.C077
- key: Run `memq find` in the words of the fact before writing a project-tier memory with the Write tool.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:300
- provenance: a3d8fbf 2026-09-06, the write-time-neighbours plan Section 3, after three review rounds found the semantic block equated with the verbs' neighbours check.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The rule holds: no verb sees a Write, so neither the shared-tier refusals nor the neighbours block runs over it. Only the paragraph splits, at the point where it turns into a description of the guard. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: (via A111) Split 300 into the pre-Write `find` rules and a shorter guard paragraph naming the guard, its door and its scope.
- baseline-test: yes
- passage: `put` prints no neighbours block, so run `memq find` in the words of the fact first.

### c5.C078
- key: Read each `memq find` semantic score against `NEIGHBOUR_FLOOR` yourself, taking the value from memq's own source.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:300
- provenance: a3d8fbf 2026-09-06, installed by the same three-round review; `NEIGHBOUR_FLOOR` was removed on 2026-10-04 by the finishing pass of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`.
- verdict: retire
- reason: row 907 (Dedupe before project write) shrink. The floor-reading instructions go, and c5.C077's landed sentence carries the search act. No local floor remains to read a score against: `find`'s semantic block is the memory database's, judged on the host model's floor pair, `FLEET_SEMANTIC_FLOOR` and `FLEET_NEIGHBOUR_FLOOR`.
- passage: So read each score yourself against the floor of whichever index answered, taking the value from memq's own source.

### c5.C079
- key: Treat a lexical hit as an overlap candidate on its own, since a record the lexical block listed is withheld from the semantic block and shows no score.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:300
- provenance: a3d8fbf 2026-09-06.
- verdict: keep
- reason: The rule keeps verbatim inside the split paragraph. A withheld record has no score to compare, so a reader waiting for one would miss the strongest overlap the query found.
- passage: Read a lexical hit as an overlap candidate on its own, since a record the lexical block listed shows no semantic score.

### c5.C080
- key: Expect `hooks/memory-frontmatter-guard.js`, a PreToolUse hook in front of Write, Edit and MultiEdit, to be the only surface that sees a record before it exists.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:300
- provenance: 426bf68 2026-08-26, the anchors-and-guard plan installed the guard; registered at hooks.json:74.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The ownership map makes this skill the owner of the project-tier frontmatter moment with the guard as its named enforcement, so the sentence naming the guard, its door and its uniqueness stays as the pointer. What the guard checks and refuses retires to the guard. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: `hooks/memory-frontmatter-guard.js` refuses any Write, Edit or MultiEdit into a tier directory but a run's pending one, naming `memq put`.

### c5.C081
- key: Expect the guard to compute the content the call would leave on disk and, where that content changes a frontmatter block, hold it to the field rules for `supersedes:`, `anchors:`, `triggers:`, `tags:`, memq field placement, and `pinned:`/`created:` date form.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:300
- provenance: 426bf68 2026-08-26; the eight named checks were gathered under one rank rule at 0d1e610 2026-08-30.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Every field rule named is a check in the guard (`frontmatterFault`, hooks/memory-frontmatter-guard.js:940-944) and a deny names the rule and the fix on its stderr line, while the field sections above already tell an author what to write.
- proposed: Delete the field-rule enumeration from 300.

### c5.C082
- key: Expect the guard to refuse a frontmatter block that opens and never closes, and one whose opening fence is not the file's first line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:300
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Both refusals are the guard's (hooks/memory-frontmatter-guard.js:960-990) and each deny line carries its reason. The why is here: memq reads either shape as a record declaring no fields at all.
- proposed: (via A115) Delete the "It refuses a block that opens and never closes" sentence.

### c5.C083
- key: Take field placement from memq's own exports so the guard and its readers cannot disagree, and keep the guard's re-spelled frontmatter read cap in step by maintenance.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:300
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: A maintainer's note rather than a session's rule, and the guard's own header states that it duplicates `FRONTMATTER_READ_CAP` rather than importing it (hooks/memory-frontmatter-guard.js:201-230), which is where a maintainer meets it.
- proposed: Delete the exports-and-read-cap sentences from 300.

### c5.C084
- key: Expect both shared tiers to refuse Write, Edit and MultiEdit, whoever is writing, with one stderr line naming the memq routes that author that tier.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:302
- provenance: 426bf68 2026-08-26, the anchors-and-guard plan Section 4: "deny every Write, Edit, and MultiEdit, for every writer including the main session"; last touched 9b1180b 2026-09-03.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- proposed: (via A121) "Both shared tiers refuse Write, Edit and MultiEdit, whoever is writing, in one stderr line naming the memq routes that author the tier. The matcher names those three tools and nothing else, so a shell redirection or an edit outside the harness passes untouched and the CLI-authored rule governs it; the operator's `pinned:` edit is one."
- baseline-test: yes
- passage: **Both shared tiers refuse Write, Edit and MultiEdit, whoever is writing**, in one stderr line naming the memq routes that author the tier.
- ruled: cut 2026-09-30

### c5.C085
- key: Expect a shell redirection or an edit made outside the harness to pass the matcher untouched, governed instead by the CLI-authored rule.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:302
- provenance: 426bf68 2026-08-26, installed with the guard's matcher (hooks.json:74).
- verdict: retire
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- passage: The matcher names those three tools and nothing else, so a shell redirection and an edit made outside the harness pass it untouched. The CLI-authored rule above governs those, the operator's own `pinned:` edit among them.
- ruled: cut 2026-09-30

### c5.C086
- key: Read a guard deny as exit 2 with one stderr line, a clean check as exit 0 with no output, and a placed-but-uncheckable record as exit 0 with a `hookSpecificOutput` object on stdout naming tier, cause, and that the write proceeds unchecked.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:304
- provenance: 426bf68 2026-08-26, the plan's Chapter 4: the guard answers three ways rather than two.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The three exits and their channels are the hook's own (hooks/memory-frontmatter-guard.js:50-62, :1325, :1504) and each answer states what it is; the reading rule that matters (c5.C089) stays. Lands as two silent allows rather than the proposal's one: the guard's own header (hooks/memory-frontmatter-guard.js:50-58) makes a checked-and-clean record silent as well as a target placed nowhere, so the clause reads 'silent where the record was checked and clean, and where nothing was placed inside the store', with the not-checked allow named as the one that speaks. Its landing respelled c5.C089's keep sentence at the fix round; c5.C089 records the flip. The speaking allow is named as a placed record the guard could not check or, under a memq version skew, any target at all, since the guard's skew branch (hooks/memory-frontmatter-guard.js:1400-1415) writes the not-checked line before placement.
- proposed: Reduce 304 to C089 with one clause naming that an allow is silent only where nothing was placed.

### c5.C087
- key: Decide which of the two allows applies by placement: once a target is placed inside the store, a parse error, unreadable file, unresolvable root or a throw all give the not-checked answer.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:304
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The routing by placement is in the guard and the not-checked line names its own cause when it fires.
- proposed: (via A124) Reduce 304 to C089 with one clause naming that an allow is silent only where nothing was placed.

### c5.C088
- key: Treat a target out of scope, under an `archive/`, not a memory filename, unplaceable, a payload with no target, or a throw on the way there as the silent allow.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:304
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The silent-allow set is decided in the guard (hooks/memory-frontmatter-guard.js:59-62), and the class rule at 306 (c5.C095) is what a session actually needs. The why is here: before placement there is no record for a not-checked line to be about.
- proposed: (via A124) Reduce 304 to C089 with one clause naming that an allow is silent only where nothing was placed.

### c5.C089
- key: Read the guard's silence as saying nothing here was its to judge, never as a judgment that came back clean.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:304
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- proposed: Read this guard's silence over a target it could not place as a statement that nothing here was its to judge, never as a judgment that came back clean.
- passage: Read this guard's silence over a target it could not place as a statement that nothing here was its to judge, never as a judgment that came back clean.
- ruled: cut 2026-09-30

### c5.C090
- key: Read the shared-tier refusal at the scope the code makes it, narrower than "the shared tiers refuse the Write tool".
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:306
- provenance: 426bf68 2026-08-26: "Two boundaries were documented wider than they are enforced, and both are narrowed here".
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- proposed: Compress 306 to the rule, the three unrefused cases, the one-class sentence and the alias residual.
- baseline-test: yes
- passage: **Read the shared-tier claim at the scope the code makes it, which is narrower than "the shared tiers refuse the Write tool".**
- ruled: cut 2026-09-30

### c5.C091
- key: Expect the guard to refuse only the shared tiers of the store this session resolves, leaving a write to a machine's real tiers outside that root unrefused.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:306
- provenance: 426bf68 2026-08-26.
- verdict: retire
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- passage: The guard refuses the shared tiers of the store this session resolves, not every shared tier on the machine. Under a `KIT_MEMORY_ROOT` override memq honors, a write to the machine's real tiers is unrefused.
- ruled: cut 2026-09-30

### c5.C092
- key: Treat a record written to the run-scoped pending tier as out of scope and unvalidated.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:306
- provenance: 426bf68 2026-08-26.
- verdict: retire
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- passage: The run-scoped pending tier is not a tier directory to memq's resolver, so a record written there is out of scope and unvalidated.
- ruled: cut 2026-09-30

### c5.C093
- key: Treat `memory-operator/archive/` and `memory-types/<type>/archive/` as placing nothing, so a record written there is allowed in silence while `memq get` still serves it and the store still syncs it.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:306
- provenance: 426bf68 2026-08-26: "A write into either shared tier's archive is allowed in silence".
- verdict: retire
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- passage: A record written into `memory-operator/archive/` or `memory-types/<type>/archive/` is allowed in silence, while `memq get` still serves it by name and the store still syncs it.
- ruled: cut 2026-09-30

### c5.C094
- key: Treat `MEMORY.md`, the decay stamp and the sidecars as out of scope on every tier, shared ones included.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:306
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: `isMemoryFilename` (memq.js:1742) is the boundary and the guard takes it from memq (hooks/memory-frontmatter-guard.js:87, :727); the class sentence at c5.C095 covers these members, which are named here: `MEMORY.md`, the decay stamp and the sidecars. Its landing respelled c5.C095's keep sentence; c5.C095 records the flip.
- proposed: Fold the `MEMORY.md`, stamp and sidecar members into the class sentence.

### c5.C095
- key: Read the out-of-scope set as one class: a target the guard cannot place inside the store is one it says nothing about.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:306
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- proposed: Those are the members worth naming rather than the boundary of the set, which is one class: a target the guard cannot place inside the store, `MEMORY.md`, the decay stamp and the sidecars among them, is a target it says nothing about.
- passage: Those are the members worth naming rather than the boundary of the set, which is one class: a target the guard cannot place inside the store, `MEMORY.md`, the decay stamp and the sidecars among them, is a target it says nothing about.
- ruled: cut 2026-09-30

### c5.C096
- key: Expect placement to try the written spelling first (extended-length and device prefixes folded off, an administrative-share UNC naming this machine rewritten to drive form), then the parent directory's resolved real path.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:306
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Placement is computed by `placeTarget` (hooks/memory-frontmatter-guard.js:354-500) and the file's own header documents both passes; no session act depends on the fold order. Its landing respelled c5.C097's keep sentence; c5.C097 records the flip.
- proposed: Delete the two-pass description from 306.

### c5.C097
- key: Expect only a target reaching the store through an alias of the root itself to survive both passes: an administrative share by qualified or aliased host name, and a mapped or substituted drive letter.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:306
- provenance: 426bf68 2026-08-26.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 908 (Frontmatter guard scope and silence), dropped under the mechanism cut.
- proposed: What placement leaves open is a target that reaches the store only through an alias of the root itself, which the guard's own header records: an administrative share by a fully qualified or aliased host name, and a mapped or substituted drive letter.
- passage: What placement leaves open is a target that reaches the store only through an alias of the root itself, which the guard's own header records: an administrative share by a fully qualified or aliased host name, and a mapped or substituted drive letter.
- ruled: cut 2026-09-30

### c5.C098
- key: Re-add a `Project-Type` line in some project of that type before running a pass over that type tier.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:310
- provenance: 8e22ff4 2026-07-31, the memory-extension plan installed the type tier and its declaring-project resolution.
- verdict: keep
- reason: No finding. The tier's files become unreachable by scan or prune when the last declaring project drops its line, and nothing detects or repairs that state.
- passage: Re-add the line in some project of that type before running a pass over it.

### c5.C099
- key: Recover a wedged type lock by confirming no writer is live, then deleting `~/.claude/memory-types/<type>/store.lock` by hand.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:311
- provenance: 8e22ff4 2026-07-31, Section 4 (locked writes); the shared-tier lock discipline was extended at 752dbce 2026-08-22; reworded 2026-10-04 by the finishing pass of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The recovery rule and "no memq command recovers it" stay, because a hand deletion of a lock file is exactly the act no verb performs. The failure-mode description and the integrity reassurance leave; recorded here, the lock is availability only, so a wedged lock costs writes rather than data. 'K07 B369's two sentences' is not in the tree, so the entry lands as: no memq command recovers a wedged type lock at its path; confirm no writer is live, then delete the entry by hand. The shared-tier writes go through the memory database and take no file lock, so `decay-prune --rollup` is the one verb the type lock still blocks (memq.js, the rollup's `acquireLock(path.join(typed.dir, STORE_LOCK_FILE))`), and the passage names it.
- proposed: K07 B369's two sentences.
- baseline-test: yes
- passage: A wedged type lock at `~/.claude/memory-types/<type>/store.lock` blocks only `memq decay-prune --rollup`, and no memq command recovers it. Confirm no rollup is running, then delete that entry by hand.

### c5.C100
- key: Run `touch --applied` on a memory you act on, and use a pin for a memory whose use is structurally invisible.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:312
- provenance: 04002f6 2026-08-25 and 5e84677 2026-08-25, the interim board that gave the reading one owner; the stamping rule dates to f270e9c 2026-07-31 and 70f4f8b 2026-08-02.
- verdict: retire
- landed: d2c43f1 section 22
- reason: row 909 (Known limits list) shrink. The Applied Stamps and Pinning sections carry the acts.
- proposed: (via A139) Reduce the bullet to the limit plus pointers: stamping per the Applied stamps section, the pin per Pinning, the `unstamped` boundary per the Applied stamps section.
- baseline-test: yes
- passage: Stamp per the Applied stamps section, pin per the Pinning section, and read `memq unstamped`'s boundary per the Applied stamps section.

### c5.C101
- key: Treat `memq unstamped` as bounded by read stamps, so a memory recognized from an index already in context never reaches its list.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:312
- provenance: 04002f6 2026-08-25; line 102's enumeration of untracked readers dates to 1f4934e 2026-08-04.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 102 enumerates the untracked readers and closes the class, the index line already in context among them, and the command names the boundary itself (memq.js:9459-9523). Safe because the pointer c5.C100 leaves reaches the owner.
- proposed: (via A139) Reduce the bullet to the limit plus pointers: stamping per the Applied stamps section, the pin per Pinning, the `unstamped` boundary per the Applied stamps section.
- baseline-test: yes

### c5.C102
- key: Read `memq unstamped`'s zeros as an absence of evidence rather than a clean sweep when it had nothing to adjudicate, no read stamp in the window, and usage evidence read whole.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:312
- provenance: 5e84677 2026-08-25 and 04002f6 2026-08-25, the rounds that ended with one owner for the reading at lines 100-104.
- verdict: retire
- landed: d2c43f1 section 22
- reason: Line 104 states the zero's reading whole, including which zero is the strong one and how the window rests on the reader's own account; this bullet is the summary, and the verb prints the verdict itself (memq.js:9520-9523).
- proposed: (via A139) Reduce the bullet to the limit plus pointers: stamping per the Applied stamps section, the pin per Pinning, the `unstamped` boundary per the Applied stamps section.
- baseline-test: yes

### c5.C103
- key: Trim the archive index by hand eventually, since it grows one line per retired memory and has no bulk prune path.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:313
- provenance: ae2c70a 2026-08-22, the whole-file read against the shipped CLI.
- verdict: retire
- reason: row 909 (Known limits list) shrink. The single-line removal is the delete verbs' and `forget`'s, and `recall` says when its read is capped.
- passage: The archive's index grows one line per memory ever retired and has no bulk prune path.
- passage: `recall` caps its read and says so, but a store archiving for years will eventually want that file trimmed by hand.

### c5.C104
- key: Keep a project at an identical path across machines, since a project tier resolves only there and there is no mapping layer.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:314
- provenance: 6cbb24a 2026-08-03, which stated the synced store's path semantics.
- verdict: retire
- landed: f92e99ec section 5
- superseded-by: E005
- reason: The incident class is live: an operator memory (`kit-project-memory-does-not-resolve-from-current-checkout`) records the kit's own project memories split across three stores by checkout path. The contrast sentence naming the tiers that resolve everywhere is the remedy, not decoration. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage, and E005's passage carries the rule; the verdict before it was keep.
- passage: A project store syncs under its flattened path, so a project tier resolves on another machine only where that project sits at the identical path.

### c5.C105
- key: Expect a freshly synced store to answer lexically until each machine builds its own semantic index on first query.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:315
- provenance: 6cbb24a 2026-08-03.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The index is built per machine on first query with no session act (scripts/memory-index.js:7), so the sentence shapes nothing a session does. The why is here: a vector is valid only against the embedder that produced it, which is why the index is derived and never synced.
- proposed: Delete the semantic-index bullet from Known limits.

### c5.C106
- key: Commit the store through the SessionStart background sync runner or the kit doctor's `-Fix`, never a bare `git add`.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:316
- provenance: 945a75c 2026-08-19, which made both committers go through the same leak probes.
- verdict: keep
- reason: The ownership map assigns the store's own commits and pushes to memory-system, and the doctrine's staging rule governs a working repository rather than this. Both sanctioned paths pass the probes that refuse a path the allowlist does not admit; a bare `git add` passes none.
- passage: Nothing else does, which is why the close-out relies on one of those rather than a bare `git add`.

### S001
- key: Run the session-recap command over the session's whole span at close-out.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:62
- provenance: 31240d3 2026-08-01, the recap section that wired the run into close-out; the line was re-extracted at 55c5abc 2026-09-09, which renumbered the finishing-work step named later on it.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: Nothing runs `memq recent` for a closing session, and the ownership map puts what the store recorded during the effort under this document, so the trigger has to be stated here. Flipped from keep to rewrite at section 22's close: S003's retire dropped the 'so the report says' clause and moved the terminal mark, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Run it over the session's span at close-out and carry the digest into the close-out status, labeled by surface.
- passage: Run it over the session's span at close-out and carry the digest into the close-out status, labeled by surface.

### S002
- key: Carry the recap digest into the close-out status, labeled by write surface.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:62
- provenance: 31240d3 2026-08-01, the recap section that wired the run into close-out; split from S001 by the re-extraction at 55c5abc 2026-09-09 and sharing its supersession of c2.C042.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The carry-into-status obligation is what makes the run reportable, and the command table row only summarises it. Flipped from keep to rewrite at section 22's close: S003's retire dropped the 'so the report says' clause and moved the terminal mark, S001 recording the same sentence, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: Run it over the session's span at close-out and carry the digest into the close-out status, labeled by surface.
- passage: Run it over the session's span at close-out and carry the digest into the close-out status, labeled by surface.

### S003
- key: Report what the store actually recorded instead of asserting that the effort banked something.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:62
- provenance: 31240d3 2026-08-01, the recap section, which wrote the run-and-carry rule with this clause as its reason.
- verdict: retire
- landed: d2c43f1 section 22
- reason: S001 and S002 are obeyable without it, so the reason lives here: a close-out that asserts "learnings banked" without the digest is unverifiable, and the digest grouped by write surface is the store's own account of what landed. Its landing respelled S001's keep sentence; S001 records the flip. Its landing respelled S002's keep sentence; S002 records the flip.
- proposed: Drop the "so the report says ..." clause from line 62 and leave the run-and-carry instruction; this ledger entry holds the reason.
- baseline-test: yes

### S004
- key: Take the close-out recap trigger from finishing-work step 8, which owns it as it owns the decay pass.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:62
- provenance: 31240d3 2026-08-01, placed on the precedent the decay pointer had set; 55c5abc 2026-09-09 inserted the finishing goal read as step 4 and renumbered steps 5 to 9, moving this pointer from step 7 to step 8.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The number is right at HEAD (finishing-work step 8 carries the memory close, the decay pass and the recap), but the ownership map assigns this moment to memory-system with finishing-work calling it, so the safe change is to keep the pointer and make step 8 the caller rather than the owner, matching the S005 rewrite.
- proposed: Keep the pointer at finishing-work step 8 as the caller of the close-out recap, with the trigger stated as this section's own, matching the c5.C062 rewrite.
- passage: The trigger is this section's own, and `finishing-work` step 8 calls it, as it calls the decay pass.

### S005
- key: Run the decay pass at close-out.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 8e22ff4 2026-07-31, which had finishing-work run the scan when the decay stamp is older than 14 days; last reworked ae2c70a 2026-08-22; re-extracted at 55c5abc 2026-09-09, which renumbered the step on this line.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule holds because nothing in memq starts a pass; the safe change is merging it with S023 into one sentence, with this section owning the trigger and finishing-work step 8 calling it, which is the ownership map's assignment.
- proposed: Merge with S023 into one sentence: the pass runs at close-out, called from finishing-work step 8, and never unprompted outside one.
- baseline-test: yes
- passage: The pass runs at close-out, called from `finishing-work` step 8, and never unprompted outside one.

### S006
- key: Treat a decay stamp older than 14 days, or an absent one, as the trigger finishing-work step 8 owns.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 8e22ff4 2026-07-31; the absent-is-due clause was a review fix for a backstop inert on a store that had never run a close-out; 55c5abc 2026-09-09 renumbered the owning step from 7 to 8, a change this claim shares with c5.C062's supersession.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The predicate stays verbatim, since the SessionStart hook's own threshold is 30 days and the 14-day reading lives only here; the safe change is rewording the owner clause so step 8 calls the pass rather than owning its trigger.
- proposed: Keep the predicate and its absent-is-due parenthetical as written; reword the owner clause so finishing-work step 8 is the caller.
- passage: It is due when the decay stamp is older than 14 days, or absent (a store where no pass has ever run is due, not exempt).

### S007
- key: Run the pass in order: `decay-scan` reports, your judgment picks, `decay-prune --rollup` with archive flags mutates, `decay-done` stamps.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 8e22ff4 2026-07-31, the plan's Approach: decay is deterministically scanned, human-judged and close-out-triggered; re-extracted at 55c5abc 2026-09-09.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The verbs report, mutate and stamp separately and no driver runs them in order; the judgment step between scan and prune is the session's. Flipped from keep to rewrite at section 22's close: S008's rewrite lifted the summarize rule out of the parenthetical, so the sentence was respelled to stand as landed. Landed as the proposal below.
- proposed: The run: `decay-scan` reports, your judgment picks, `decay-prune --rollup` with the archive flags mutates, `decay-done` stamps.
- passage: The run: `decay-scan` reports, your judgment picks, `decay-prune --rollup` with the archive flags mutates, `decay-done` stamps.

### S008
- key: Make the summarize edit the pass's only hand edit, and hand-edit the project tier alone.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, the whole-file read that found finishing-work prescribing two hand edits the shared tiers bar; re-extracted at 55c5abc 2026-09-09.
- verdict: rewrite
- landed: f92e99ec section 5
- reason: The routing holds because the frontmatter guard refuses every write tool on both shared tiers, so the project tier is the only place a hand edit can land; compressing the sentence out of its parenthetical loses no instruction. Its landing respelled S007's keep sentence; S007 records the flip. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was rewrite.
- proposed: State the rule as its own short sentence in the compressed pass paragraph, in the order the calls are made.
- baseline-test: yes
- passage: A project-tier summary is a `memq put --replace`.

### S009
- key: Summarize a shared-tier candidate through `add-type` or `add-operator` with `--update`, a body flag and `--confirm-shared`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, installed with S008 as one sentence and sharing its supersession of c5.C065; re-extracted at 55c5abc 2026-09-09.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The guard's deny line names only the creation spelling, so the repair spelling stays prose, but the reference row at line 30 and the shared-tier repair paragraph already carry it; a pointer at that path here loses nothing.
- proposed: Replace the spelled-out repair invocation with a clause pointing at the shared-tier repair path above.
- passage: A shared-tier candidate is summarized through the shared-tier repair path above.

### S010
- key: Treat `--confirm-shared` as one flag covering the whole invocation, never one flag per target.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22: the flag is consumed by two independent gates; re-extracted at 55c5abc 2026-09-09.
- verdict: keep
- reason: The scope is the CLI's, but it is the fact every split-call rule follows from, and the verb reveals it only after the type tier's gate has been waived.
- passage: `--confirm-shared` is one flag for the whole invocation, never one per target.

### S011
- key: Always pass `--confirm-shared` with `--archive-operator`.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; the pass was designed at 8e22ff4 2026-07-31 as a close-out act made where the operator is near; re-extracted at 55c5abc 2026-09-09.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The verb refuses an operator archive without the flag and the reference row at line 35 already states the requirement, so the standalone sentence is a duplicate; folding it into the split rule as its premise keeps the one thing it does here, which is to shape the call.
- proposed: Fold into S014 as its premise clause (the operator gate is unconditional, so it earns its own call) rather than a separate sentence.
- baseline-test: yes
- passage: The operator tier's gate is unconditional, so give any operator-tier archive its own `decay-prune` call

### S012
- key: Rely on the target check, which refuses the whole pass and names the memory it could not find, to catch a mistyped name.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; re-extracted at 55c5abc 2026-09-09.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The target validator refuses the whole pass before anything mutates and names the tier and the memory, so the run reports the failure itself; recorded here so nobody re-adds the reassurance.
- proposed: Delete the "a mistyped name is caught separately ..." clause.

### S013
- key: The type tier's gate is the one moment a retirement reaching past this project stops for a second look, and pre-supplying the flag waives it.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, the whole-file read that found one boolean serving two gates.
- verdict: retire
- landed: d2c43f1 section 22
- reason: S014 and S017 are obeyable without it, so the reason lives here: a type-tier retirement reaches every declaring project on every synced machine, the refusal is the only surface that names that reach, and a flag supplied before the refusal answers a question nobody asked.
- proposed: Drop the "The type tier's gate is the opposite ..." sentence from the passage; this ledger entry holds the reason.
- baseline-test: yes

### S014
- key: Give any operator-tier archive its own `decay-prune` call and run the type-tier archive in a separate call without the flag.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, the whole-file read that found one boolean serving two gates; re-extracted at 55c5abc 2026-09-09.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule holds and nothing enforces it; the security model records the split as prose-enforced with no mechanical check, and one combined call waives the type tier's cross-project gate silently. Only wording and order change, with S011 folded in as the premise.
- proposed: State the split as one sentence with its premise clause, first among the call-shape rules of the compressed paragraph.
- baseline-test: yes
- passage: The operator tier's gate is unconditional, so give any operator-tier archive its own `decay-prune` call and run the type-tier archive in a separate call without the flag.

### S015
- key: Put `--rollup` on exactly one call, the project tier's.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, installed with the split-call discipline; re-extracted at 55c5abc 2026-09-09.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule holds unenforced, since nothing counts rollups across calls; wording compresses with the paragraph while S016 carries its cost here.
- proposed: Keep as one sentence beside the split rule, with S016's reason retired to the ledger.
- baseline-test: yes
- passage: `--rollup` rides exactly one of the calls, the project tier's.

### S016
- key: A second `--rollup` run can rewrite a sidecar a lock-free stamp touched since the first and spend that file's only backup generation on the already-pruned copy.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, installed as S015's reason.
- verdict: retire
- landed: d2c43f1 section 22
- reason: S015 is obeyable without it, so the cost lives here: the read-stamp hook appends without a lock, a second rollup rewrites the sidecar it touched under the same single `.bak`, and the pre-prune copy is gone.
- proposed: Drop the "because a second run of it can rewrite ..." clause; this ledger entry holds the reason.
- baseline-test: yes

### S017
- key: Add `--confirm-shared` to the type-tier call only after the refusal has named the projects the retirement would reach.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; re-extracted at 55c5abc 2026-09-09.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The rule holds because the refusal is the only surface that names the reach and the flag once passed waives the gate for the whole invocation; only the wording compresses.
- proposed: Keep as one sentence directly after the split rule.
- baseline-test: yes
- passage: Add `--confirm-shared` to that type-tier call only once the refusal has named the projects the retirement would reach.

### S018
- key: Ask the operator rather than adding the flag where the refusal reports that the scan of declaring projects could not be established.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; `projectsDeclaringType` answers null with "could not scan ... for declaring projects" and the gate refuses on null exactly as on more than one; re-extracted at 55c5abc 2026-09-09.
- verdict: keep
- reason: The operator gate guards blast radius: the reach is genuinely unknown on that refusal shape, and confirming past it buys exactly the retirement the gate exists to ask about.
- passage: Where the refusal says the scan of declaring projects could not be established, the reach is unknown, so ask the operator rather than add the flag.

### S019
- key: Combining the two archives in one call waives the type tier's gate silently, which is the whole reason to split them.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22, installed as S014's reason beside S013.
- verdict: retire
- landed: d2c43f1 section 22
- reason: S014 is obeyable without it, so the reason lives here with S013's: the flag is invocation-wide, so satisfying the operator gate on a combined call answers the type gate too, and the verb says nothing about it.
- proposed: Drop the "Combining the two in one call ..." sentence; this ledger entry and S013's hold the reason.
- baseline-test: yes

### S020
- key: A pass that needed the flag and omitted it refuses having changed nothing, so a retry costs a round and no work.
- class: rationale-example
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; the verb acquires every lock and runs its validators before anything mutates; re-extracted at 55c5abc 2026-09-09.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The split rule is obeyable without the reassurance, which restates the verb's validate-before-mutate posture; recorded here that a refused pass changes nothing, so splitting a call wrongly costs one round.
- proposed: Delete the "A pass that needed the flag and omitted it ..." sentence.

### S021
- key: Under the engine store signals, archive what the pass names and leave the journal rollup to an attended session.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 752dbce 2026-08-22, the shared-tier plan's grant list; the denylist gained `--drop-malformed` at 5ac33f5 2026-08-25; re-extracted at 55c5abc 2026-09-09.
- verdict: keep
- reason: The grant hook withholds `--rollup` mechanically on the unattended vector and this sentence is the only surface telling the pass what to do instead; the gate guards a rewrite of every tier's sidecar under a single backup the sync never carries.
- passage: Under the engine store signals the grant covers bare `decay-prune` and its archive flags but not `--rollup`, so a pass there archives what it names and leaves the rollup to an attended session.

### S022
- key: Expect the SessionStart hook to nudge once the decay stamp is 30 or more days overdue.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: 8e22ff4 2026-07-31, the SessionStart backstop; re-extracted at 55c5abc 2026-09-09.
- verdict: retire
- landed: d2c43f1 section 22
- reason: The nudge is emitted by `hooks/memory-session.js` at its own 30-day constant and names the overdue pass when it fires, so the prose predicts what the environment already says.
- proposed: Delete the "The SessionStart hook nudges ..." sentence.

### S023
- key: Do not run `decay-prune` unprompted outside a close-out.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:296
- provenance: ae2c70a 2026-08-22; the pass was designed at 8e22ff4 2026-07-31 as a close-out act made where a human is near; re-extracted at 55c5abc 2026-09-09.
- verdict: rewrite
- landed: d2c43f1 section 22
- reason: The bar holds and nothing enforces it on an attended session; merging it with S005 into the one sentence stating when the pass runs loses no instruction.
- proposed: Merge with S005 into one sentence: the pass runs at close-out and never unprompted outside one.
- baseline-test: yes
- passage: The pass runs at close-out, called from `finishing-work` step 8, and never unprompted outside one.

### T001
- key: Sync the store without asking, at any time and as often as you like, since the doctrine's closed list of never-gated channels names the store's own sync and that entry covers no other act.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:66, the hand-path paragraph's opening sentences.
- provenance: c5881f9 2026-09-13, batch 2 ruling 13 of the corpus rewrite's rulings, given because sessions spent a decision ask on a sync the operator had already granted where the paragraph left the question unsaid; landed by the corpus-rewrite follow-up plan's section 3, and recorded here at that plan's finishing pass, fix rounds 1 and 2.
- verdict: keep
- reason: The store is private and made to sync, so the paragraph opens by stating the grant before it states the hand paths, and a session reading it meets the permission before the mechanics. The grant names its owner, the doctrine's closed list, so this skill states where the permission sits rather than conferring it. The last sentence bounds it: the doctor's `-Fix` consent (c2.C048), the PASS-or-FIXED gate and its FAIL stop (c2.C049) and the leak probe all stand under it. `docs/security-model.md`'s credential paragraph records what taking either hand path unasked costs.
- passage: Syncing the store needs no go-ahead, for any session at any time, under the doctrine's closed list: a commit of what the allowlist admits, a pull with rebase, then a push, the manual pair below included. A failing leak probe is reported, not asked about.

### D001
- key: Expect a record's `MEMORY.md` index line description to win over its frontmatter `description:` line wherever the index line holds text, and expect a record with no index line, or an empty one, to rank, publish and be judged on that frontmatter value instead, left out of the `MEMORY.md` block session start prints but ranked in the session-start fleet block like any other record on a machine with the memory database.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:148
- provenance: the persona-memory-port plan's section 3, landed so an unindexed distillate the port writes still ranks, publishes and is judged on its own description.
- verdict: retire
- landed: f92e99ec section 5
- reason: `listMemories` and `collectRecords` (`scripts/memq.js`, `scripts/memory-database.js`) both fall back to the frontmatter `description:` only where the index holds no text for the file, through the one helper `frontmatterDescription` exports. The `MEMORY.md` block session start prints (`hooks/memory-session.js`'s `projectMemoryBlock`) reads the raw index file and nothing else, so it leaves an unindexed record unnamed. The session-start fleet block is a different surface, reached through `memq.fleetMemoryBlock` and `fleetMemoryLine`, and it ranks whatever row the host holds for a published record, index line or not, since a publish already carries the frontmatter description through `collectRecords`. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage; the verdict before it was keep.
- passage: - **A record's `MEMORY.md` index line wins over its frontmatter `description:` line wherever it holds text.** With no index line, or an empty one, the frontmatter value stands in.

### D002
- key: Remove a project-tier record outright with `memq forget <name> --confirm`, and read its last stdout line for what the memory database will do with the record's row.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:43
- provenance: the persona-memory-port plan's section 5, landed so a removal the operator orders by name takes every local copy and index line with it and says what the host does with the row.
- verdict: retire
- landed: c822a4e8 section 6
- superseded-by: E009
- reason: The flag is `--confirm` rather than `--confirm-shared` because a project-tier removal has no reach across projects. The host line has three forms because the publisher (`scripts/memory-database.js`, `publish`) names a project row removed only when its walk read that row's store and found no file for it: a store the walk reads empty, or a walk that could not read some tier, holds every removal back. `cmdForget` spawns `db-sync` only where `db-sync` itself would publish, a config file present and the store root the machine's default, so the line never promises a publish that cannot run. The store counts as empty when neither the live directory nor `archive/` holds a record file, the walk's own test, since a retired record is published too. Retired on 2026-10-04 by section 6 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which rewrote the `forget` row to the soft delete `cmdForget` sends, with no locked operation and no host-row line, and E009's passage carries the row; the verdict before it was keep.
- passage: `memq forget <name> --confirm` | Remove a project-tier record outright, in one locked operation. Without the flag it refuses, having changed nothing. Its last stdout line says what the memory database will do with the record's row.

### D003
- key: Spawn `memq judged --situation "<text>"` for the judged fleet block's lines over the working project's own records, cut to its segment and optionally one tag, and read stderr for why it printed nothing.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:33
- provenance: the persona-memory-port plan's section 2 built the verb and section 6 wrote its row, so a persona plugin that spawns memq reads its own memories and never another project's private records.
- verdict: keep
- reason: The cut rides `mem.usp_Search`'s `@p_Segment` and `@p_Tag`, applied where the procedure fills its visible set, because a filter over the thirty rows the procedure already chose answers empty for a small store among a large fleet's. The verb withholds the vector-order fallback, since a caller asking for a judged ranking must not receive an unjudged one under the same name, and it exits 0 on every empty answer as `recall` does, so a caller tells a stand-down from nothing-cleared by stderr alone. It is granted on the unattended vector because it writes nothing but the shown record, `recall`'s own class.
- passage: The judged fleet block's lines over this project's own records, for a caller that spawns memq. Stdout is at most ten judged lines and never the vector-order fallback. Every empty answer exits 0 with its reason on stderr.

### D004
- key: Write an unindexed project-tier record with `memq put <name> "<description>"`, which files it where memq resolves the store and writes no `MEMORY.md` line.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:42
- provenance: the persona-memory-port plan's section 4 built the verb and section 6 wrote its row, on the operator's ruling of 2026-09-25 that the persona's distillates stay out of session start's opening text.
- verdict: rewrite
- landed: e09d31a8 section 5
- reason: A caller that spawns memq cannot reproduce the resolver's legs, a store pin, a worktree's main checkout and a transcript filing, so a path it derived itself files records where no reader looks. The index is what session start prints, so a record written without a line ranks and publishes on its frontmatter description (D001) while staying out of every session's opening text. The caller owns its names, which is why a duplicate is refused rather than updated and why there is no neighbours block. Rewritten on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record; the passage now quotes the text that carries the rule; the verdict before it was keep.
- passage: `memq put <name> "<description>" (--body "..."\|--body-file <path>) [--tag t]... [--author <a>] [--replace]` | Write one project-tier record, carrying the checkout's space; `--replace` overwrites an existing name, restating every field, the space included, but the pin, which it keeps.

### D005
- key: Read `memq judged` as the fleet block's judged lines for a spawning caller, not as a digest a session reads at effort start.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:59, the paragraph's closing sentence
- provenance: the persona-memory-port plan's section 6, beside the verb's table row (D003).
- verdict: keep
- reason: The Recall section tells a session to read the whole digest rather than search first, and a verb whose name sounds like recall invites a session to reach for it there. The sentence places it: it shows only what the judge chose over one project's segment, which is too narrow for a session's own ranking of the store.
- passage: `memq judged` prints only the fleet block's judged lines for one project's segment, for a caller that spawns memq, so a session still starts from the digest.

### D006
- key: Write an indexed project-tier record with the Write tool and an unindexed one with `memq put`, and run `memq find` in the words of the fact before either.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:350, the frontmatter guard section's opening sentences
- provenance: the persona-memory-port plan's section 6, which rewrote the opening that named the Write tool as the project tier's only door once `memq put` became a second one (D004).
- verdict: retire
- landed: f92e99ec section 5
- superseded-by: E002
- reason: The two doors write different records, one that session start prints and one it leaves out, so the paragraph names both by what they write. Neither runs the neighbours block the shared-tier verbs print, so the advice to search first covers both. Retired on 2026-10-04 by section 5 of `docs/archive/claude-kit_memory-in-sql_spec_v1.md`, which made the memory database the record and removed this passage, and E002's passage carries the rule; the verdict before it was keep.
- passage: A project-tier memory arrives through the Write tool, into the memory write destination the SessionStart hook names, which writes the indexed record whose `MEMORY.md` line you write beside it, or through `memq put`, which writes the unindexed one. Neither path prints the shared-tier verbs' neighbours block, so run `memq find` in the words of the fact before either write.

### E001
- key: Write and read every memory record through `memq`, whose database is the record, and never through a file tool.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:162, the Memory Database Layer section's opening sentence
- provenance: the memory-in-sql plan, on the operator's words of 2026-10-02: "SQL memory is the tool all the way down, excepting the local queue and small cache", and "I like one tool being responsible for ALL our memory processes".
- verdict: keep
- reason: Two doors let two machines edit one record apart, which is the conflict the git sync could not settle and the database would have had to rebuild. One door is also the one place a later hook or augmentation attaches. The frontmatter guard (`hooks/memory-frontmatter-guard.js`) refuses every Write, Edit and MultiEdit into a tier directory but a run's pending one, so the rule is enforced at the file tools, and this sentence is what names the door a refused session turns to.
- passage: **The shared memory database holds every record, and `memq` is its one door.**

### E002
- key: Write a project record with `memq put` and correct one with `memq put --replace`, searching with `memq find` first.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:244, the Search Before Writing section
- provenance: the memory-in-sql plan's write-door paragraph and its section 5, which retired the Write tool as the project tier's door.
- verdict: keep
- reason: A name the store already holds is refused unless `--replace` is given, so a correction is an explicit act and a second session cannot overwrite a record by reusing its name. A replace states the record whole and clears every list it does not name, which is why the correction text names the tags and the anchor and trigger verbs. `put` prints no neighbours block, so the search before a write is the session's own.
- passage: A project-tier memory is written with `memq put`, and a correction with `memq put --replace`.

### E003
- key: Expect a write the host does not take to land in the local queue and drain in order.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: the memory-in-sql plan's queue paragraph, on the operator's words of 2026-10-02: "what would be worse is being unable to save a memory during an outage."
- verdict: keep
- reason: The operator refused losing a save to an outage, so the queue is the load-bearing part of the outage design. A write that reaches the host drains the queue before sending its own row, so a row queued in an outage never lands after a write made once the host returned. A refused queued write is filed under `memory-snapshot/refused/` and passed, because a refusal held in place would wedge every later save behind it.
- passage: A write the host does not answer lands in the local queue, `~/.claude/kit-memory-db-queue.sqlite`, reports `queued`, and drains in order when a write or `memq db-refresh` next reaches the host.

### E004
- key: Read the snapshot line as an outage answered from this machine's last copy, not as the database.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:162
- provenance: the memory-in-sql plan's read-side paragraph, on the operator's words of 2026-10-02 that losing retrieval in an outage is "basically Fail Fast and Fail Loud".
- verdict: keep
- reason: A read verb falls back to `~/.claude/memory-snapshot/` with one line naming the host and the copy's age, since a silent fallback is the failure the operator refused, and the down marker holds every read off the host for sixty seconds, so a burst of calls in an outage costs one timeout. Session start's project and type blocks read the snapshot, so no hook but the fleet block waits on the host.
- passage: The read verbs ask the database first, and where it does not answer they read the snapshot, `~/.claude/memory-snapshot/`, saying so with the copy's age.

### E005
- key: Expect a project's records to be keyed by its git remote, so a checkout on any machine reads the same project memories.
- class: rule
- source: plugins/grimoire/skills/memory-system/SKILL.md:250, the Known Limits bullet on folder-keyed projects
- provenance: the memory-in-sql plan's project-key paragraph, on the operator's words of 2026-10-02: "Project memories SHOULD follow the project."
- verdict: keep
- reason: The key is `remote:` and the origin remote's host and path, read from the checkout's `.git/config` with no git spawn (`projectKey` in `scripts/memq.js`), so the same repository keys alike wherever it sits. A checkout with no origin, and a folder that is no checkout, keep `path:` and the folder's segment, which is the one case the bullet names as a limit.
- passage: - A project with no git origin is keyed by its folder, so another machine reads its records only where that project sits at the identical path.

### E006
- key: Declare a checkout's space in its own `.kit/memory-space`, or in `KIT_MEMORY_SPACE`, to order what its reads list first.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:164
- provenance: the memory-in-sql plan's space paragraph, on the operator's words of 2026-10-02 about the client worktrees of one master repository: memories "could conflate slightly", which is "not a bad thing, just something that would be nice if there was slightly more guidance about that extra level of separation."
- verdict: keep
- reason: The worktrees share one project key, so the space orders rather than hides: own space first, unspaced next, other spaces last and marked, never dropped. It is read from the directory the project resolves to, a worktree's own top and not its main checkout (`projectSpaceRoot` in `scripts/memq.js`), since each client worktree declares its own. The label reaches a SQL parameter and a line in a model's context, so it is held to `^[a-z0-9][a-z0-9-]{0,39}$`, and a label outside it is refused on one stderr line and the run goes on with no space rather than failing the verb.
- passage: **A checkout can declare a space**, one label of lowercase letters, digits and hyphens, in `.kit/memory-space` in the directory its project resolves to, which is a worktree's own top, the filed project's top, or else the working directory, or in `KIT_MEMORY_SPACE`, which wins.

### E007
- key: Delete a shared record that was never true with `delete-type` or `delete-operator` under `--confirm-shared`, which marks its database row deleted so no database read serves it, removes no file, and queues where the host does not answer.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:172, the Delete bullet under Shared-Tier Repair and Removal
- provenance: the memory-in-sql plan's section 6, which sends the shared-tier deletes through `mem.usp_ArchiveRecord` the way `memq forget` sends a project one.
- verdict: keep
- reason: An undeleted row is served by every read verb and session start on every machine, so a delete that removed only this machine's files left the record live everywhere. The row is kept with the deleted mark, which no read procedure serves. Session start and the recognition nudge read a machine's snapshot on every session and tool call, host up or not, so the record shows there until that snapshot is next refreshed, and the bullet says so. The queue stands behind the call as it does behind every write, so an outage never loses the deletion. `mem.usp_ArchiveRecord` resolves the newest undeleted row of the name, archived or not, so an archived record is deleted like a live one. The host answers a name it holds no undeleted row of as absent, and the verb refuses it with exit 1, so a mistyped name is caught rather than reported deleted.
- passage: **Delete** is `delete-type <type> <name> --confirm-shared`, and the operator twin. It marks the record's row deleted in the memory database, which no database read serves, and it removes no file. Session start and the recognition nudge read each machine's snapshot whether the host is up or not, so they keep showing the record on a machine until its snapshot is next refreshed. Where the host does not answer, the deletion waits on the local queue like any other write. When the host answers, a name it holds no undeleted record of is refused, and an archived record is deleted like a live one.

### E008
- key: Retire a type-tier record with `memq delete-type <type> <name> --confirm-shared`, which marks its database row deleted after naming the projects declaring the type, and sends nothing without the flag.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:39
- provenance: the memory-in-sql plan's section 6, with E007.
- verdict: keep
- reason: The row is the verb's reference entry and the Delete bullet at line 172 owns what the deletion does (E007). The declaring-projects line is the reach a caller weighs before consenting, and the refusal without `--confirm-shared` sends nothing, since the deletion reaches every project declaring the type.
- passage: `memq delete-type <type> <name> --confirm-shared` | Mark a type-tier record's row deleted in the memory database. Names the projects declaring the type before it acts. Without the flag it refuses, having sent nothing.

### E009
- key: Retire a project-tier record with `memq forget <name> --confirm`, which marks its database row deleted with the queue behind it, removes no file, and sends nothing without the flag.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:38
- provenance: the memory-in-sql plan's section 3, which sent `forget` through `mem.usp_ArchiveRecord`; the row was respelled to match by its section 6.
- verdict: keep
- reason: The row is the verb's reference entry. `cmdForget` (`scripts/memq.js`) sends one `usp_ArchiveRecord` row with the deleted mark through `writeThrough`, so a host that does not answer queues it, and it touches no file. The flag is `--confirm` rather than `--confirm-shared` because a project-tier removal has no reach across projects, and the refusal without it sends nothing.
- passage: `memq forget <name> --confirm` | Mark a project-tier record's row deleted in the memory database, with the local queue behind it where the host does not answer. It removes no file. Without the flag it refuses, having sent nothing.

### E010
- key: Expect no memory database under a store root that is not this machine's own: record writes refuse with exit 1, the four read verbs serve no shared record with exit 0, a verb reaching for the shared tiers names the root on one stderr line, session start prints that line once, and a run's pending tier works as anywhere.
- class: mechanic
- source: plugins/grimoire/skills/memory-system/SKILL.md:16
- provenance: the memory-in-sql plan's section 7, under the ARCHITECT's ruling and the operator's decision of 2026-10-04 recorded in the plan's Intent.
- verdict: keep
- reason: The client config and the login come from the home directory while the store root moves with `KIT_MEMORY_ROOT`, so a redirected process would read and write the machine's own records under the machine's login. `hostConfig` (`scripts/memory-database.js`) refuses before any probe, down marker, queue row or snapshot write, through the one predicate `storeRootServesDatabase`, and every record verb reaches the host through it. A write that landed nowhere exits 1, and a read exits 0 because such a process has no shared record by design rather than by fault. The read verbs read neither the host nor the home snapshot there, and the session hook and the recognition nudge read no snapshot either. The line is the shared tiers' answer, so a `get` the pending tier answers prints none, and the sentence claims no database a machine without a config lacks. The pending tier is file-based and never meets the door, so engine runs keep it. The shared deletes and the store-signal flags refuse earlier under the same signals, so the door never reaches them.
- passage: **A store root that is not this machine's own reaches no memory database.** A database config, where the machine has one, answers for the machine's own store. So where `KIT_MEMORY_ROOT` names another root, every record write refuses with exit 1, and `get`, `find`, `recall` and `recent` serve no shared record with exit 0. A verb that reaches for the shared tiers names the root on one stderr line, and session start prints that line once in place of its memory blocks. A run's pending tier still writes and reads as it does anywhere, and a `get` its pending record answers prints no such line.
