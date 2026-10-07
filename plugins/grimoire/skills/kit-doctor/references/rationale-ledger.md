# Rationale ledger: kit-doctor

This file is the rationale ledger for the documents the `kit-doctor` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/kit-doctor/SKILL.md

This document is the kit-doctor skill: it tells a session how to validate and repair a machine's grimoire installation using the doctor command that ships inside the plugin payload. It owns the moments of locating the correct `doctor.cmd` among competing copies and verifying it is genuine, choosing between check mode, `-Fix`, and `-Fix -Yes` and the consent each requires, reading the doctor's exit codes and its per-line verdicts (doctrine freshness, memory sync and credential exposure, the semantic-search embedder), and the post-fix re-check and reporting. A session loads it on a named trigger: when the kit was just installed or updated on a machine, when a kit capability such as hooks, memory tooling, or doctrine loading misbehaves, or when the operator asks to run the doctor, check the install, or verify kit setup. Load class: `named-trigger`.

Extracted at `6bc07fb`: whole document (`skills.kit-doctor.SKILL.md`). Redrafted on 2026-09-26 by section 8 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `19c75af0` with its fix round at `6f26f01a`, so every live entry's `passage:` line quotes the text at `6f26f01a` and the `flag:` lines record that pass's flags. Amended by `docs/plans/claude-kit_goal-leash-removal_spec_v1.md` section 4 on 2026-10-06, which removed the goal leash: C008's reason no longer cites the deleted kit-goal skill.

### C001
- key: Do not fetch anything before running the doctor; it ships inside the plugin payload on every machine that has the plugin.
- class: rationale-example
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:8
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's design decision that the doctor ships in the payload so every plugin update delivers the current doctor (docs/archive/claude-kit_kit-doctor_spec_v1.md).
- verdict: retire
- landed: 3d2b3cd section 41
- reason: The locate rule at line 12 is obeyed without this clause; the why lives here. The doctor sits at `<plugin root>/doctor/` inside the payload, so a session never fetches or clones anything before locating it. Retired at section 41's close: the clause after the semicolon is gone and line 8 reads "One command validates the whole install and names the fix for anything missing. The doctor ships inside the plugin payload, so every machine with the plugin has it.".
- proposed: Drop the clause after the semicolon at line 8 ("there is nothing to fetch first"); the ledger entry for C001 carries the why.

### C002
- key: Locate the doctor by taking the first of the three listed paths that exists.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:12
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Section 2, which specified the locate order as plugin root, then the registered clone from the signpost, then a `doctor.cmd` in the cwd tree.
- verdict: keep
- reason: The first-that-exists rule is what makes the installed copy, the one this machine's sessions load, the default reporter (see C008). It is the owner of the ordering; C006's restatement retires into it.
- passage: Take the first path that exists:

### C003
- key: Try `<plugin root>\doctor\doctor.cmd` first, resolving the plugin root from `CLAUDE_PLUGIN_ROOT` or else this skill's base directory's grandparent.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:14
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Section 2.
- verdict: keep
- reason: No finding. The installed copy reports on the payload the machine's sessions actually load (f102d37), which is why it is first.
- passage: `<plugin root>\doctor\doctor.cmd`, the installed copy, with the root from `CLAUDE_PLUGIN_ROOT` or else this skill's base directory's grandparent.

### C004
- key: Try `<kitRepoPath>\plugins\grimoire\doctor\doctor.cmd` second, taking `kitRepoPath` from `~/.claude/grimoire.local.json`.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:15
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Section 2 (the signpost's `kitRepoPath`).
- verdict: keep
- reason: No finding. The clone path exists to check the clone (C009), not to substitute for the install's verdict.
- passage: `<kitRepoPath>\plugins\grimoire\doctor\doctor.cmd`, with `kitRepoPath` from `~/.claude/grimoire.local.json`.

### C005
- key: Try `doctor.cmd` at the cwd's repo root third, when working inside a kit clone.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:16
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Section 1 reduced the repo-root `doctor.cmd` to a forwarder to the payload.
- verdict: keep
- reason: No finding. The repo-root copy is a forwarder; its one recorded defect (a rejected flag exiting 0, 97d306f) was fixed in the forwarder, so the path stays usable.
- passage: `doctor.cmd` at the cwd's repo root, inside a kit clone.

### C006
- key: Prefer paths 1 and 2; use the cwd repo-root copy only as a last resort.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:16
- provenance: 318d6bf 2026-07-10, installed with the locate list; no incident of its own.
- verdict: retire
- landed: 3d2b3cd section 41
- reason: "Take the first path that exists" (C002) already fixes the preference over the same three candidates, so this is a within-document duplicate. Safe to delete because the forwarder's only known defect was fixed in code at 97d306f rather than by avoiding it. Retired at section 41's close: the last-resort sentence is gone and line 16 carries C005's path sentence alone, "3. `doctor.cmd` at the cwd's repo root, when working inside a kit clone.", its text unchanged.

### C007
- key: Expect each copy to report only on its own root, so the installed copy reports on the payload this machine's sessions load and the clone reports on the clone.
- class: rationale-example
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:18
- provenance: f102d37 2026-08-23, the dormant-feature-removal plan's blind-reviewer Major: a restored cache-lag caution told the operator to prefer the clone, and since every doctor check resolves against its own root, a clone run would have produced a clean report about the wrong payload.
- verdict: retire
- landed: 3d2b3cd section 41
- reason: The two instructions it supports (C008, C009) are obeyed without it, so it moves here. The mechanism to remember before reinstalling "prefer the clone": every check resolves against the doctor's own root, so a clone run never inspects the stale cache the machine's sessions load. Retired at section 41's close: the mechanism sentence and the divergence opener are gone from line 18, which now carries the three sentences recorded under C008.
- proposed: Move "Every check resolves against the doctor's own root ..." to the ledger; the rewrite at A006 carries the surviving two instructions.

### C008
- key: Treat path 1's report as the verdict on the machine, and run `claude plugin update` when the installed cache lags the clone.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:18
- provenance: f102d37 2026-08-23, the blind-reviewer Major above; the passage replaced a deleted "prefer the clone" bullet whose subject was a removal switch.
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: The instruction stays as written; only the divergence story around it compresses (A006), with its mechanism carried at C007 here. Lands at line 18 (section 41's close) as "Path 1's report is the verdict on the machine. `claude plugin update` is the remedy when the installed cache lags the clone. Run path 2 to check the clone, never to get a better answer about the install.", the proposal's three parts as three sentences on the writing-skills one-idea bar, C009's sentence closing it.
- proposed: Replace line 18 with: path 1's report is the verdict on the machine, `claude plugin update` is the remedy when the installed cache lags the clone, and path 2 checks the clone, never the install; the C007 mechanism sentence moves to the ledger.
- baseline-test: yes
- passage: Path 1's report is the verdict on the machine. `claude plugin update` is the remedy when the installed cache lags the clone.

### C009
- key: Run path 2 to check the clone, never to get a better answer about the install.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:18
- provenance: f102d37 2026-08-23, the same blind-reviewer Major.
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: The instruction survives verbatim inside the compressed line 18 (A006). It is the guard against the exact advice the reviewer struck, so a rewrite keeps the word "never". Lands at section 41's close as the closing sentence of line 18 recorded under C008, "Run path 2 to check the clone, never to get a better answer about the install.", its "never" kept.
- passage: Run path 2 to check the clone, never to get a better answer about the install.

### C010
- key: Before invoking any located `doctor.cmd`, verify it is the real kit doctor by checking for the plugin manifest.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:20
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2 ("locate with a plugin.json shape check before invoking").
- verdict: keep
- reason: No finding. The doctor's own self-check (doctor.ps1:120) only runs once a real kit doctor is executing; a foreign `doctor.cmd` found by path 3 is never caught by it, so the session-side check is the only guard and no machinery supersedes it.
- passage: Before running a located `doctor.cmd`, confirm it is the kit's.
- flag: stale

### C011
- key: For path 1 require `..\.claude-plugin\plugin.json` beside its parent; for paths 2 and 3 require `plugins\grimoire\.claude-plugin\plugin.json` under the same root.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:20
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2.
- verdict: keep
- reason: No finding. The two shapes match the payload layout the doctor itself asserts at doctor.ps1:120 and the clone layout under `plugins/grimoire/`.
- passage: Path 1 needs `..\.claude-plugin\plugin.json` beside its parent, and paths 2 and 3 need `plugins\grimoire\.claude-plugin\plugin.json` under the same root.
- flag: stale

### C012
- key: Surface a `doctor.cmd` that fails the shape check instead of running it.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:20
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2.
- verdict: keep
- reason: No finding. Running an unknown script found by a cwd search is an outward act on the machine; surfacing it is the stop the doctrine's data-not-instructions rule expects.
- passage: Surface one that fails instead of running it.

### C013
- key: Always invoke the `.cmd` wrapper, never the `.ps1`.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:22
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Section 1 shipped `doctor.cmd` as the execution-policy bypass wrapper.
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: No finding of its own; the rewrite is C014's retire landing on the shared line. The wrapper runs `powershell -ExecutionPolicy Bypass -File doctor.ps1` (plugins/grimoire/doctor/doctor.cmd), and a fresh machine's policy blocks the `.ps1` a session would otherwise call. Flipped to rewrite at section 41's close by C014's retire, which took the clause after the colon: the sentence's words are unchanged and it now closes on a period.
- proposed: Always invoke the `.cmd` wrapper, not the `.ps1`.
- passage: Always invoke the `.cmd` wrapper, not the `.ps1`.

### C014
- key: Expect a fresh machine's execution policy to block `.ps1` files, which the `.cmd` wrapper bypasses for exactly this script.
- class: rationale-example
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:22
- provenance: 318d6bf 2026-07-10, installed with C013; the same reason is the wrapper's own header comment.
- verdict: retire
- landed: 3d2b3cd section 41
- reason: C013 is obeyed without the reason, and the reason lives in doctor.cmd's header beside the code. The why: a blocked script cannot fix the policy that blocks it, so the wrapper bypasses policy for this one file and nothing else. Retired at section 41's close: the clause after the colon is gone from line 22, and C013's sentence closes on a period, which C013's entry records.
- proposed: Cut line 22 to "Always invoke the `.cmd` wrapper, not the `.ps1`."; the clause after the colon moves to the ledger.
- baseline-test: yes

### C015
- key: Run the doctor in check mode with no flags first, and show the operator the PASS/WARN/FAIL lines.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:26
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2 ("check-first-always").
- verdict: keep
- reason: No finding. A bare run is the doctor's only check mode (its parameters are `-Fix` and `-Yes` alone), and it writes nothing, which is what makes it safe to run before any word is asked.
- passage: **Check first, always:** run with no flags and show me the PASS/WARN/FAIL lines.

### C016
- key: Give a one-line reading of each WARN and FAIL, naming what it breaks and the printed remediation.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:26
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2.
- verdict: keep
- reason: No finding. The doctor prints a remediation with every non-PASS line; the reading is what turns it into the operator's decision about `-Fix`.
- passage: Read each WARN and FAIL in one line: what it breaks and its printed remedy.

### C017
- key: Never run `-Fix` unprompted; run it only on the operator's word.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:27
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2 ("`-Fix` on my word"); the repair inventory grew at ec46854 (embedder) and eac64fa (store sync).
- verdict: keep
- reason: A blast-radius gate: `-Fix` writes execution policy, the shim, the store repository and its managed files, installs software and wires hooks, and the operator-tier gotcha records show a fix pass rewrites drifted managed files and spends a pending operator decision as a side effect. The coordinator's off-Windows "hand run of the fix pass" and the operator's store-sync grant do not widen it: the moment's owner, memory-system:66, requires the go-ahead before `-Yes`, and the standing-grants plan ruled the sanctioned hand path is `sync-store.ps1`, not the fix pass.
- passage: **`-Fix` only on my word:**
- flag: stale

### C018
- key: Expect `-Fix` to apply durable repairs (execution policy, memq shim wiring, the memory store's sync repo and allowlist, the local embedding stack, kaizen signpost and clone git hooks), prompt before installing anything, and delete only the temp file its own failed signpost write left behind.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:27
- provenance: 318d6bf 2026-07-10 installed the description; "It deletes nothing" came at 8edc578 2026-07-24 to keep the destructive `-RemoveLegacyRelay` switch off the `-Fix -Yes` path, and the inventory grew at ec46854 and eac64fa; the doctor honesty plan (2026-09-23) narrowed it to the one temp file a failed signpost write leaves; section 2 of `docs/archive/claude-kit_sidecar-retirement_spec_v1.md` (2026-10-05) added the retired sidecar's task, daemon and state folder, which the doctor's "Retired sidecar" check removes behind its consent prompt.
- verdict: keep
- reason: The doctor does all of this itself, but the sentence is the content of the ask C017 requires: nothing shows the operator what `-Fix` will write before the word is asked, so the prose is the informed consent. Keep the inventory in step with the doctor's section headers when a repair is added or removed. Finishing fix: the inventory gained the `autoCompactWindow` write into user `settings.json`, behind its own consent prompt, which the doctor's own header lists and the sentence had omitted. The deletion bound names the sidecar removal because that check deletes a folder and a scheduled task the run did not write, so "only temp files and backups its own run wrote" would be false without it; the bound now reads "Beyond those", so it still holds for every other repair.
- passage: it prompts before installing anything. Its repairs include installing the local embedding stack and committing the store's sync through its gated allowlist. It runs `memq db-sync` unprompted where the memory database step warns. On consent, it also removes the retired sidecar's scheduled task and state folder and stops its daemon. Beyond those, it deletes only temp files and backups its own run wrote.

### C019
- key: Use `-Fix -Yes` only when the operator says the run is unattended.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:28
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2 ("`-Yes` named before use and required for tool shells").
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: The heading is narrower than the plan that installed it and than the tool-shell clause beside it: `-Yes` is required through a tool shell because the doctor declines every prompt on a redirected stdin, so the in-chat yes is the operator's word there. The rewrite states the bar as the operator's word in either form and loosens nothing. Lands at line 28 (section 41's close) with the lead "`-Fix -Yes` only on my word, for an unattended run or an attended install through a tool shell after the in-chat ask:", the two forms named together as the first proposal spells them; the whole bullet is recorded under C021.
- proposed: Reword the bullet heading so `-Fix -Yes` is passed only on the operator's word, with the two forms that word takes named together: an unattended run, or an attended install through a tool shell after the in-chat ask.
- proposed: One rewrite of line 28 carrying A012's heading, the "authorizes nothing by itself" statement, and the tool-shell chat-ask route with its one-clause reason; the prompt inventory moves per A015.
- baseline-test: yes
- passage: **`-Fix -Yes` only on my word:** for an unattended run, or through a tool shell after my yes in chat.
- flag: stale

### C020
- key: Expect `-Yes` to pre-answer the consent prompts `-Fix` already asked for, such as an install or writing an absent `autoCompactWindow` value.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:28
- provenance: 318d6bf 2026-07-10 installed `-Yes` as "answer all prompts, for unattended runs"; the replacement-waits-for-a-person clause rides the doctor's `-Interactive` consent (doctor.ps1:75-95, :1741), reworded on this line at 97d306f 2026-08-23.
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: The pre-answer statement stays because it is what the session tells the operator; the prompt inventory leaves because the doctor prints each decline with its reason ("this one needs a person, since it replaces a value you chose"). Safe because the only behaviour the inventory described is reported by the run itself. Lands at line 28 (section 41's close) as "`-Yes` pre-answers the consent prompts `-Fix` already asked for.", the parenthetical inventory gone.
- proposed: Keep "`-Yes` pre-answers the consent prompts `-Fix` already asked for" and drop the parenthetical; the doctor's own decline line names the interactive-only case.
- baseline-test: yes
- passage: `-Yes` pre-answers the consent prompts `-Fix` already asked for.

### C021
- key: State before running `-Yes` that it authorizes nothing by itself.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:28
- provenance: 8edc578 2026-07-24, the relay-cleanup commit that separated the destructive removal switch from `-Fix -Yes` and made `-Yes` a consent carrier only.
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: The instruction survives verbatim inside the compressed line 28 (A013). It exists so a session never reads `-Yes` as a grant: it consents to what the run's other flags already asked for, and the operator's word is the authorization. Lands at line 28 (section 41's close) as "It authorizes nothing by itself. Name that before running it." inside the bullet "**`-Fix -Yes` only on my word, for an unattended run or an attended install through a tool shell after the in-chat ask:** `-Yes` pre-answers the consent prompts `-Fix` already asked for. It authorizes nothing by itself. Name that before running it. A `-Fix` run through a tool shell cannot show me its prompt, since the doctor declines on a redirected stdin. So when an install is needed, ask me in chat first and then pass `-Yes`.".
- passage: It authorizes nothing by itself, so name that before running it.

### C022
- key: When an install is needed and `-Fix` runs through a tool shell, ask the operator in chat first, then pass `-Yes`.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:28
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2 ("required for tool shells"); the doctor's Get-Consent declines on a redirected stdin and says so.
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: A blast-radius gate that survives as written inside the rewritten bullet: the chat round is the consent for a software install the doctor cannot ask for through a tool shell, and memory-system:66 carries the same round for the store commit. Keep the one-clause reason (the prompt cannot reach a redirected stdin), or a session waits for a prompt that never comes. Lands at line 28 (section 41's close) as "A `-Fix` run through a tool shell cannot show me its prompt, since the doctor declines on a redirected stdin. So when an install is needed, ask me in chat first and then pass `-Yes`.", the one-clause reason kept in the document's own words.
- passage: The doctor declines prompts on a redirected stdin, so for an install through a tool shell, ask me in chat first.
- flag: stale

### C023
- key: Read exit 0 with warnings as a working install with named gaps.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:32
- provenance: 4ad4f83 2026-08-23, the dormant-feature-removal finishing pass, which restated the exit-code contract after 97d306f fixed the forwarder.
- verdict: keep
- reason: No finding. The doctor exits 0 with WARN lines by design; a session must not read a WARN as a stop.
- passage: Exit 0 with warnings is a working install with named gaps.

### C024
- key: On exit 1, use the report body to tell a real broken-dependency finding apart from no report at all, which is the doctor rejecting an undefined flag.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:32
- provenance: 4ad4f83 2026-08-23, a declared deviation: after 97d306f made the forwarder exit 1 on a rejected flag, exit 1 means two things, and an operator reading a bare exit 1 as a broken install was the failure that fix existed to prevent.
- verdict: keep
- reason: The discriminator is the instruction, and the incident recurs whenever a flag is added or removed while an older or newer doctor sits on a machine. No machinery reads the exit code on the session's behalf.
- passage: Exit 1 is a report that found something broken, or no report at all when the doctor rejected an unknown flag. The report body tells them apart.

### C025
- key: When exit 1 produced no report, fix the command line rather than the install, since no checks ran.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:32
- provenance: 4ad4f83 2026-08-23, the same deviation.
- verdict: keep
- reason: Kept whole with C023 and C024 (A017): the compression offered dropped the report-body discriminator, which is what tells the two exit-1 cases apart.
- passage: With no report no checks ran, so fix the command line, not the install.

### C026
- key: Read a doctrine-freshness WARN as the installed plugin lagging the clone or the reverse, which the doctrine-refresh hook resyncs on the next session once the plugin is current.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:33
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2; the hook is plugins/grimoire/hooks/doctrine-refresh.js, wired in hooks.json.
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: Flipped from keep to rewrite at the corpus rewrite's finishing fix round: the doctor prints the label `Doctrine import`, not "doctrine-freshness", and that label has four WARN branches (no import line, no doctrine file yet, installed copy differs, operating-instructions skill not found at the payload path), of which only the differs branch is the lag reading; the sentence names the label, bounds the reading to that branch, and says which of the other three print a remedy. The hook does the resync; the reading tells the session which remedy (a plugin update) precedes it.
- proposed: A `Doctrine import` WARN reading that the installed copy differs from the payload's skill body usually means the installed plugin lags the clone (or the reverse); the doctrine-refresh hook resyncs on the next session once the plugin is current. No manual file copying. Its other three branches carry no such reading: a missing import line and a doctrine file not yet written each print their remedy on the line, and the branch that finds no operating-instructions skill at the payload path prints only that freshness cannot be verified.
- passage: A `Doctrine import` WARN that the installed copy differs usually means the plugin lags the clone, or the reverse. The doctrine-refresh hook resyncs next session once the plugin is current.

### C027
- key: Do not copy doctrine files manually.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:33
- provenance: 318d6bf 2026-07-10, installed with C026.
- verdict: keep
- reason: No finding. A hand copy fixes one machine once and drifts at the next update; the refresh hook is the mechanism and the rule keeps sessions off the manual path.
- passage: Never copy doctrine files by hand.

### C028
- key: Read the `Memory sync` line before any push, because its FAIL means credentials are in reach.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03, the memory-sync section: the store root is `~/.claude`, which also holds `.credentials.json`, `settings.json`, `history.jsonl` and every transcript, and the doctor gained four probes that prove the exclusion rather than assume it; widened at 70c3a3b 2026-08-28 to name the coordinator directory.
- verdict: keep
- reason: The one doctor line whose FAIL is a credential exposure rather than a broken feature, so it is read before the outward act it guards. Overlap with C032 is intentional: this says when the line is read, C032 what a FAIL earns.
- passage: Read `Memory sync` before any push. Its FAIL means credentials are in reach.

### C029
- key: Expect the store root to hold `.credentials.json`, `settings.json`, `history.jsonl`, and every session transcript, with the repository there admitting only the memory tiers and the machine coordinator directory.
- class: rationale-example
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03 installed the inventory; 70c3a3b 2026-08-28 corrected it to name the coordinator directory and rebuilt the pin as a sweep over every boundary sentence in the shipped tree.
- verdict: keep
- reason: A pinned copy: test/doctrine-parity.test.js (around :4119-4340) sweeps every "admits only" sentence in the shipped tree and reddens if one omits an admitted root, so the sentence must stay correct while it exists. It also tells a session reviewing a foreign managed file by hand (C033) what the repository may admit.
- passage: The store root holds `.credentials.json`, `settings.json`, `history.jsonl` and every session transcript, and the repository there admits only the memory tiers and the machine coordinator directory.

### C030
- key: Read a `Memory sync` PASS as the allowlist being canonical and all four probes answering clean.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03 (check-ignore, dry-run add, ls-files and filtered rev-list, with the count of probes that answered).
- verdict: keep
- reason: No finding. PASS is a proven negative over four surfaces, not an absence of complaints, which is why the reading names the probes.
- passage: PASS means the allowlist is canonical and all four probes answered clean.

### C031
- key: Read a `Memory sync` WARN as the store root not being a repository yet, so nothing syncs and nothing is at risk; `-Fix` initializes it.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03.
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: Flipped from keep to rewrite at the corpus rewrite's finishing fix round: `doctor/doctor.ps1` emits six `Memory sync` WARN branches (git off PATH, not a repository, no origin remote, destination branch unreadable, destination advisory, no readable remote-tracking branch) and only the not-a-repository branch is `-Fix`'s to clear, so the reading is bounded to that branch and the rest read at the line, which prints a remedy for most of them and states the gap only for an unreadable destination branch and the other-branches advisory. The not-a-repository WARN is the one safe state on this line; without the reading a session treats a fresh machine as a leak.
- proposed: The WARN reading that the store root is not a repository yet means nothing syncs and nothing is at risk, and `-Fix` initializes it; the line's other WARN branches (git off PATH, no origin remote, an unreadable destination branch, a destination advisory, no readable remote-tracking branch) are not `-Fix`'s to clear: most print their remedy on the line, while an unreadable destination branch and the advisory that origin carries other branches state the gap only.
- passage: The WARN that the store root is not a repository yet means nothing syncs or is at risk, and `-Fix` initializes it. Its other WARNs are not `-Fix`'s to clear, so read their remedy or gap on the line.

### C032
- key: Stop and read on every `Memory sync` FAIL.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03; the coordinator's and memory-system's "a FAIL there is a stop, not a push" restate it for the manual push (ff59e19 2026-09-01).
- verdict: keep
- reason: kit-doctor owns the reading of the doctor's report and states every FAIL class with its remedy; the coordinator and memory-system carry the stop as pointers. The stop exists because the four FAIL classes take four remedies and the wrong one is useless or destructive.
- passage: Every `Memory sync` FAIL is a stop-and-read, and each class has its own remedy:

### C033
- key: When a managed file the doctor did not write, or a repository it did not create, is reported, review it by hand, since the doctor will not touch it.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03 ("it never writes into a repository it did not create, and ownership rests on a git config marker"); the Foreign-versus-Drift inversion is recorded in the gotcha memories doctor-fix-is-never-a-neutral-committer and doctor-fix-rewrites-marker-carrying-managed-files.
- verdict: keep
- reason: `-Fix` refuses a Foreign file so as not to destroy a stranger's rules; the by-hand review is the only remedy, and no machinery performs it.
- passage: A managed file the doctor did not write, or a repository it did not create, is one it leaves alone. Review it by hand.

### C034
- key: Treat a drifted or missing allowlist as letting an add stage anything, and run `-Fix` to restore it.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03 ("the allowlist is re-derived on every run, so a drifted ignore file is a FAIL").
- verdict: keep
- reason: Names `-Fix` as the remedy and does not license an unprompted run: C017 still governs when it runs, and the gotcha records show why the word matters (a fix pass rewrites every drifted marker-carrying file at once).
- passage: A drifted or missing allowlist lets an add stage anything. `-Fix` restores it.

### C035
- key: For named leak paths, remedy with a history rewrite plus credential rotation rather than `-Fix`, which will not clear them.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03 ("a filtered rev-list reads the object history, which the first three cannot see because untracking a blob does not remove it").
- verdict: keep
- reason: The one FAIL class where running the obvious remedy does nothing: untracking removes no blob, so the rule points at the rewrite and the rotation and keeps a session from reporting a leak as fixed.
- passage: Named leak paths are tracked or reachable in history. `-Fix` cannot clear them, since untracking leaves the blob. Rewrite history and rotate credentials.

### C036
- key: Treat probes that could not answer as an unproven negative rather than a clean result, which is why they fail rather than warn.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: eac64fa 2026-08-03 ("a probe that cannot answer is a FAIL, never a quiet pass").
- verdict: keep
- reason: No finding. The doctrine's withheld-control rule in one line: silence from a probe that could not run is not a clean sweep.
- passage: Probes that could not answer leave the negative unproven, not clean, so they fail rather than warn.

### C037
- key: Read the `Embedder (semantic search)` line as reporting whether `memq find`'s local embedding stack is installed at `~\.claude\kit-embedder`.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:36
- provenance: ec46854 2026-08-03, the doctor's embedder section.
- verdict: retire
- reason: row 833 (Embedder line semantics) shrink. The report line names the stack and its location. The act survives in "`memq shim` and `Embedder (semantic search)` name their remedy on the line.".
- passage: `Embedder (semantic search)` reports `memq find`'s local embedding stack at `~\.claude\kit-embedder`.

### C038
- key: Read `absent` as nothing installed yet, with `find` still working lexical-only, and `unusable` as a present package with a missing or incomplete model cache needing repair rather than a fresh install.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:36
- provenance: ec46854 2026-08-03 ("absent is an install and unusable is a repair, and an operator who cannot tell them apart runs the wrong command").
- verdict: keep
- reason: No finding. The two states were separated by design so the remedy named is the right one.
- passage: With the embedder absent, `memq find` still works lexical-only.

### C039
- key: Expect `-Fix` to install or repair the embedder after a consent prompt naming about 400 MB of disk cost.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:36
- provenance: ec46854 2026-08-03 ("the install runs behind the existing consent prompt, which states the disk cost so the consent is informed"; the npm guard is doctor.ps1:1218-1229).
- verdict: rewrite
- landed: 3d2b3cd section 41
- reason: The cost stays because through a tool shell the doctor's prompt never reaches the operator and the in-chat ask (C022) must carry it. The npm-not-on-PATH clause and the runtime aside leave safely because the doctor prints the npm case itself. Lands at line 35 (section 41's close) as "`-Fix` installs or repairs it after a consent prompt naming the real disk cost (about 400 MB).", the runtime parenthetical and the npm clause gone, the four keeps sharing the line untouched.
- proposed: Keep "`-Fix` installs or repairs it after a consent prompt naming the real disk cost (about 400 MB)"; drop the platform-runtime parenthetical and the "never prompts when `npm` is not on PATH" clause.
- baseline-test: yes
- passage: Its install costs about 400 MB of disk, which `-Fix`'s consent prompt names.

### C040
- key: Read the index-health lines (record count, model identity, age) as describing the derived search index without rebuilding or touching it.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:36
- provenance: ec46854 2026-08-03 ("a check that rebuilt the index would have changed the thing it was reporting on").
- verdict: retire
- reason: row 833 (Embedder line semantics) shrink. The index-health lines are reference the report prints, and they change no act.
- passage: The index-health lines (record count, model identity, age) describe the search index and never rebuild it.

### C041
- key: Treat an absent or empty search index as normal on a machine that has not yet run a semantic query.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:36
- provenance: ec46854 2026-08-03.
- verdict: keep
- reason: No finding. Without it an empty index reads as a defect on every fresh machine.
- passage: An absent or empty index is normal before a machine's first semantic query.

### C042
- key: After a `-Fix` run, re-run check mode and report which lines flipped.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:39
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2.
- verdict: retire
- reason: row 835 (Post-fix recheck and disclosure) merge. The owner is the doctrine's "Run the real thing before you call it done" (home/grimoire-doctrine.md:99). The pointer is "After `-Fix`, re-run check mode under the doctrine's "Run the real thing before you call it done", and name what the fix changed on the machine under its "Name any shared or local state you altered outside the code".".
- passage: After `-Fix`, re-run check mode and report which lines flipped.

### C043
- key: Report in one line each anything the fix changed on the machine, such as PATH, execution policy, or installed software.
- class: rule
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:39
- provenance: 318d6bf 2026-07-10, the kit-doctor plan's Chapter 2.
- verdict: retire
- reason: row 835 (Post-fix recheck and disclosure) merge. The owner is the doctrine's "Name any shared or local state you altered outside the code" (home/grimoire-doctrine.md:163). The pointer is the same sentence as for C042.
- passage: Name in one line each what the fix changed on the machine, such as PATH, execution policy or installed software.

### C044
- key: Read the Locate section's path-2 sentence as: a clone run also reads the installed copy on the memq shim, `Memory sync` and embedder steps, and where the machine matches the installed copy and not the clone, those three report INFO with `-Fix` installing nothing there.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:18
- provenance: the doctor honesty plan's section 1 (docs/archive/claude-kit_doctor-honesty_spec_v1.md), 2026-09-23.
- verdict: keep
- reason: No finding. States the doctor's three-way verdict at the point a session picks which path's report to trust, ahead of the per-check INFO readings C045 to C047 carry.
- passage: On a clone run, an INFO reading `trails the checkout in hand` means the machine matches the installed copy, and `-Fix` from the clone changes nothing there.

### C045
- key: Read a `Memory sync` INFO as the allowlist matching the installed copy and not the clone, with `-Fix` from that clone leaving the store as found since the installed copy's doctor commits pending memories.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:34
- provenance: the doctor honesty plan's section 1 (docs/archive/claude-kit_doctor-honesty_spec_v1.md), 2026-09-23.
- verdict: retire
- reason: merged into C044's sentence, which is the same trailing rule stated for every clone-run step (row 823 shrink). Its separate `Memory sync` INFO passage and the "matching neither copy is the drift FAIL" sentence go. The drift FAIL remains under C034.
- passage: INFO means the allowlist matches the installed copy, and `-Fix` from the clone then leaves the store as found.
- passage: Where the machine matches the installed copy and not the clone, those report INFO reading `trails the checkout in hand`, and `-Fix` from the clone installs nothing there.

### C046
- key: Read a `memq shim` INFO as the bin matching the installed copy and not the clone, with `-Fix` from that clone reinstalling nothing, and expect a shim that does not run to never read as trailing.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:35
- provenance: the doctor honesty plan's section 1 (docs/archive/claude-kit_doctor-honesty_spec_v1.md), 2026-09-23.
- verdict: retire
- reason: row 832 (memq shim line semantics) shrink. Its trailing-INFO act is carried by C044's sentence. The not-running exclusion is reported on the shim line itself, and the line names its remedy.
- passage: A shim that does not run never reads as trailing, since it is healthy for no copy.
- passage: Where the machine matches the installed copy and not the clone, those report INFO reading `trails the checkout in hand`, and `-Fix` from the clone installs nothing there.

### C047
- key: On a clone reading absent or unusable, read the Embedder's INFO as the stack being ready for the installed copy, with `-Fix` from that clone offering no install.
- class: mechanic
- source: plugins/grimoire/skills/kit-doctor/SKILL.md:36
- provenance: the doctor honesty plan's section 1 (docs/archive/claude-kit_doctor-honesty_spec_v1.md), 2026-09-23.
- verdict: keep
- reason: No finding. Keeps a session from offering the roughly 400 MB install C039 names when the installed copy already carries a usable stack.
- passage: On a clone run, an INFO reading `trails the checkout in hand` means the machine matches the installed copy, and `-Fix` from the clone changes nothing there.
