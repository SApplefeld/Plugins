# Rationale ledger: branch-hygiene

This file is the rationale ledger for the documents the `branch-hygiene` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/branch-hygiene/SKILL.md

This document is the kit's branch-hygiene procedure: it tells a session how to sweep local branches and worktrees left over after Branch-and-PR efforts, and how to recover branches whose commits never reached the trunk. It owns three moments: deciding which local branches and Claude Code worktrees may be auto-deleted (the safe set and the protected set), running the reap-and-report procedure itself, and recovering a stranded post-merge branch onto a fresh recovery branch with a new PR before any delete. It also owns the optional remote-side companion setting. A session loads it as a `named-trigger`: the frontmatter says to use it when cleaning up leftover branches or worktrees, or when the SessionStart nudge flags reapable or stranded branches, with triggers listed for branch cleanup, reaping or pruning merged branches, recovering stranded post-merge commits, and worktree cleanup.

Extracted at `6bc07fb`: whole document (`skills.branch-hygiene.SKILL.md`). Redrafted on 2026-09-26 by section 9 of `docs/plans/claude-kit_corpus-compression_spec_v1.md`, landed at `47e74f8f` with its fix round at `5288cfb5`, so every live entry's `passage:` line quotes the text at `5288cfb5` and the `flag:` lines record that pass's flags. Amended by `docs/plans/claude-kit_goal-leash-removal_spec_v1.md` section 4 on 2026-10-06, which removed the goal leash: C016's reason names the probe by its new file name. Amended by `docs/archive/claude-kit_stacked-pr-base_spec_v1.md` section 1 on 2026-10-06, which made the integration branch a branch's pull request base first: C007 and C012 quote the new text, and C036 to C039 are new. Amended by `docs/archive/claude-kit_stacked-pr-base_spec_v1.md` section 4 on 2026-10-06, which sent a merged pull request whose base had already landed when it merged to the fallback: C040 carries it, and C007's reason points at it.

### C001
- key: Sweep only branches and worktrees whose work has already landed, and leave everything else untouched.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:8
- provenance: 971042a 2026-06-23, the branch-hygiene plan (docs/archive/claude-kit_branch-hygiene_spec_v1.md), whose root cause was that finishing-work's Branch-and-PR teardown never fires because the merge lands on the platform after the session ends.
- verdict: rewrite
- landed: 617317a section 43
- reason: The lead paragraph restates the safe set and the hard rules that follow; it compresses to one sentence pointing at them, and the why-they-pile-up sentence lives here: in a strict-PR shop the merge happens outside the session, so cleanup must be a later reaper keyed on the merge having happened. Lands at line 8 (section 43's close) as "This sweeps local branches and worktrees whose work has already landed and leaves everything else alone, under the conditions The safe set and Hard rules below state.", one sentence composed from the three proposed lines read together, the third governing and agreeing with the first two; the why-they-pile-up sentence is gone from the document and this reason carries its why.
- proposed: Compress line 8 to one lead sentence that names the sweep and points at The safe set and Hard rules for the conditions; drop the restated conditions from the lead.
- proposed: Move the why-they-pile-up sentence to the ledger and merge the remainder into A001's one-sentence lead.
- proposed: Folded into A001's lead sentence.
- baseline-test: yes
- passage: This skill sweeps local branches and worktrees whose work has landed, under Safe Set and Hard Rules, and leaves everything else alone.

### C002
- key: Auto-remove only what you can verify is merged.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:8
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 1's tightening of the auto-delete trigger to verified-merged membership only.
- verdict: retire
- landed: 617317a section 43
- reason: Duplicate of C006 (the safe-set condition) and C030 (the membership test); both owners carry the rule whole with the ref and the command, so the lead's copy adds nothing a session needs. Retired at section 43's close: the clause is gone with line 8's third sentence, C006 (line 14) and C030 (line 40) carrying the rule.
- proposed: (via A005) Delete the "auto-removes only what it can verify is merged" clause from line 8; C006 and C030 carry it.
- baseline-test: yes

### C003
- key: Never force-delete an unmerged branch or a dirty worktree.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:8
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 1 and Chapter 3 (the `-d` and `worktree remove` refusal paths verified on a fixture).
- verdict: retire
- landed: 617317a section 43
- reason: Duplicate of C030 and C031, which name the commands the prohibition applies to and the report as the alternative; the lead's copy carries neither. Retired at section 43's close: the clause is gone with line 8's third sentence, C030 (line 40) and C031 (line 41) carrying the rule.
- proposed: (via A007) Delete the "never force-deletes an unmerged branch or a dirty worktree" clause from line 8; C030 and C031 carry it.
- baseline-test: yes

### C004
- key: Recover stranded branches before sweeping anything else.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:10
- provenance: c800e05 2026-06-26, whose message does not narrate it; the diff adds the stranded intake paragraph and the recovery section as the after-the-fact net for the merge-strand-guard incident (post-merge doc commits on a branch whose remote was deleted), which the nudge hook detects.
- verdict: rewrite
- landed: 617317a section 43
- reason: The nudge invites a reap at session start and a stranded branch pruned in that reap loses commits the trunk never received; this ordering is what keeps the sweep from running first. It orders recovery against the sweep, where C022 orders it against the single delete, so the two are not one rule twice. Flipped to rewrite at section 43's close by C005's retire, which took 'are a data-loss risk and' from inside the sentence: the priority rule and its ordering are unchanged.
- proposed: Stranded branches take priority: recover them before sweeping anything.
- passage: Stranded branches take priority: recover them before sweeping anything.

### C005
- key: Treat stranded branches as a data-loss risk, so give them priority over reapable ones.
- class: rationale-example
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:10
- provenance: c800e05 2026-06-26, with the merge-strand-guard plan (docs/archive/claude-kit_merge-strand-guard_spec_v1.md) as the incident: records written after a fast merge stranded off the integration branch with no signal.
- verdict: retire
- landed: 617317a section 43
- reason: The priority rule (C004) is obeyable without the data-loss clause, which is its why: a stranded branch holds commits nowhere else, so deleting it is the one unrecoverable act in this skill, and that is why recovery precedes any sweep. Retired at section 43's close: 'are a data-loss risk and' is gone from line 10 and C004's sentence reads "Stranded branches take priority: recover them before sweeping anything.", which C004's entry records.
- proposed: Drop "are a data-loss risk and" from line 10, leaving the priority rule and its ordering; the reason lives in this ledger.
- baseline-test: yes

### C006
- key: Auto-reap a local branch only if it is verified merged into the integration branch.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:14
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 1: the spec's "upstream gone OR ancestor" trigger was tightened at build to verified-merged only, since a gone-but-unmerged branch may be squash-merged elsewhere or abandoned.
- verdict: rewrite
- landed: 617317a section 43
- reason: The rule stays; the paragraph splits one mechanic per sentence and its parenthetical moves here: `git branch --merged` is reliable because the kit's repos use regular merges, under which a landed branch's tip is an ancestor of the integration ref; a squash-merge repo would defeat it, which the merge-strand-guard plan lists as out of scope. Lands at line 14 (section 43's close) with the regular-merges parenthetical gone; the one-sentence-per-condition shape the proposal orders was already the line's shape at HEAD, so the three sentences stand as they were, C007's now closing on a period, which C007's entry records.
- proposed: Split line 14 into one sentence per condition (branch, integration ref, worktree) and move the regular-merges parenthetical to the ledger.
- baseline-test: yes
- passage: A local branch is auto-reaped only if it is **verified merged into the integration branch**.

### C007
- key: For a branch with no open or merged pull request, a remote with no such read, or a merged pull request whose base is gone after the fetch or already an ancestor of the fallback (`git merge-base --is-ancestor origin/<baseRefName> <fallback>`), take the integration branch as `origin/develop` if it exists, else `origin/main`, else `origin/master`.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:14
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Approach paragraph 3: in NEO a feature branch lands via PR into `develop` and `develop` reaches `main` later behind a full test run, so `develop` is the integration target where it exists. Amended by docs/archive/claude-kit_stacked-pr-base_spec_v1.md section 1, 2026-10-06: the order became the fallback for a branch with no pull request, C036 carrying the pull request base clause that now comes first. Amended by docs/archive/claude-kit_stacked-pr-base_spec_v1.md section 4, 2026-10-06: a merged pull request whose base had already landed when it merged takes the fallback too, in its own sentences, which C040 carries.
- verdict: rewrite
- landed: 617317a section 43
- reason: The fallback order encodes a real repo topology (develop ahead of main) and the nudge hook resolves only this order, so a branch it flags as stranded is re-read against its pull request base (C036) before recovery; the safe set owns the definition and step 2 points at it after the rewrite. Flipped to rewrite at section 43's close by C006's rewrite, which took the regular-merges parenthetical after the clause. The stacked-pr-base plan then made the order the fallback, also for a base that no longer resolves, since a merged pull request keeps naming a parent branch the host deleted on its merge, and a parent that already landed but kept its branch would hide work that never reached the trunk. A closed pull request's base is no integration branch, since its work landed nowhere through it, so a branch whose pull requests all closed unmerged takes the fallback, and a remote no host CLI reads has no read at all. A child merged into a parent that had already landed and kept its branch also takes this fallback, by C040, since the ancestor condition does not catch that parent.
- proposed: For a branch with no open or merged pull request, a remote with no such read, or a merged pull request whose base is gone after the fetch or already an ancestor of the fallback (`git merge-base --is-ancestor origin/<baseRefName> <fallback>`), the integration branch is `origin/develop` if it exists, else `origin/main`, else `origin/master`.
- passage: For a branch with no open or merged pull request, a remote with no such read, or a merged pull request whose base is gone after the fetch or already an ancestor of the fallback (`git merge-base --is-ancestor origin/<baseRefName> <fallback>`), the integration branch is `origin/develop` if it exists, else `origin/main`, else `origin/master`.

### C008
- key: Reap a worktree only if it lives under `.claude/worktrees/`, sits on a reapable branch, and has a clean working tree.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:14
- provenance: 971042a 2026-06-23, the branch-hygiene plan: `.claude/worktrees/` is Claude Code's own convention observed in the NEO session, and worktrees elsewhere may be the operator's own.
- verdict: keep
- reason: The path bound keeps the reaper off hand-made worktrees and the clean bound keeps it off uncommitted work; the safe set owns these conditions and step 4 keeps the commands and the clean test after the rewrite, its worktree clause pointing here for the bounds (corrected in place at section 43's close).
- passage: A worktree is reaped only if it lives under `.claude/worktrees/`, sits on a reapable branch, and has a clean working tree.

### C009
- key: Never touch `develop`, `main`, `master`, the current branch, or the repo's default branch.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:16
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Approach and Section 1 (the protected set by name).
- verdict: rewrite
- landed: 617317a section 43
- reason: This list and Hard rule 3 each name a member the other omits (the default branch here, a worktree outside `.claude/worktrees/` there); this line becomes the one whole protected list and Hard rule 3 points at it, so a session reading either surface sees every member. Lands at line 16 (section 43's close) as "Protected, never touched no matter what: `develop`, `main`, `master`, the current branch, the repo's default branch, and a worktree outside `.claude/worktrees/`.", the one whole list of six members; Hard rule 3 (C032) points at it.
- proposed: (via A017) The safe set's protected line (C009) gains the outside-worktree member; Hard rule 3 (C032) becomes a pointer at that line.
- baseline-test: yes
- passage: Protected, never touched: `develop`, `main`, `master`, the current branch, the repo's default branch, and a worktree outside `.claude/worktrees/`.

### C010
- key: Run `git fetch --prune` first so the integration ref and remote-tracking refs are current.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:20
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 4: a no-fetch pass stayed silent because the local `origin/develop` was stale while the merge had landed on the platform.
- verdict: keep
- reason: No finding. The merged set is only as true as the last fetch, and the recorded incident is exactly a stale ref hiding a landed merge.
- passage: 1. `git fetch --prune` to refresh the integration and remote-tracking refs.
- flag: weak-reason

### C011
- key: Stop and report, deleting nothing, if the fetch fails or no integration ref resolves.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:20
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Section 1 acceptance ("a non-repo or git failure is reported, not fatal") and Chapter 4's stale-ref incident.
- verdict: keep
- reason: A blast-radius gate: with stale or absent merge state the sweep cannot tell merged from unmerged, and the delete it would run is unrecoverable for an unmerged branch. No hook enforces it; the nudge hook fails open and never deletes.
- passage: If it fails or no integration ref resolves, stop and report without deleting.

### C012
- key: Resolve the sweep's integration ref as the safe set's fallback.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:23
- provenance: 971042a 2026-06-23, the branch-hygiene plan, installed with C007 in the same commit. Key amended by docs/archive/claude-kit_stacked-pr-base_spec_v1.md section 1, 2026-10-06.
- verdict: rewrite
- landed: 617317a section 43
- reason: Step 2 restates C007's list with no command of its own; it becomes a pointer at the safe set's definition, which is safe because the list survives whole in C007 and the nudge hook. Lands at line 21 (section 43's close) as "2. Resolve the integration ref in the order The safe set above gives.", the list surviving whole on line 14 and in hooks/branch-reaper-nudge.js. The stacked-pr-base plan narrowed it to the sweep's ref, the fallback, since the safe set now resolves a pull request base per branch and the sweep needs one ref for every branch (C037).
- passage: 2. Resolve the integration ref for the sweep, the fallback under Safe Set.

### C013
- key: Compute the merged set with `git branch --merged <integration-ref>`, then drop the protected names and the current branch's `*` line.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:22
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 1 (the merged set as the only trigger) and Chapter 3 (the set verified to drop `develop` and `main` on a fixture).
- verdict: keep
- reason: No finding. This is the mechanical test the whole safe set rests on, and the nudge hook computes the same set (`branch --merged <integ>`).
- passage: 3. Compute the merged set: `git branch --merged <integration-ref>`, minus the protected list.

### C014
- key: Record each merged branch's tip SHA with `git rev-parse <name>` before removing anything.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:23
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Approach: every removal reports its restore command because the commits are already on the integration branch.
- verdict: keep
- reason: No finding. The SHA is what makes `git branch -D` recoverable and is the rollback line the doctrine's stop rule asks for; after the rewrite this step and C018 are the only statements of it.
- passage: 4. For each merged branch, record its tip SHA (`git rev-parse <name>`) before any delete.

### C015
- key: Remove a merged branch's worktree with `git worktree remove <path>` and no `--force`.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:23
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 3 and Chapter 4 (the operator chose to auto-remove worktrees too; dirty ones are skipped and git refuses them without `--force`).
- verdict: rewrite
- landed: 617317a section 43
- reason: The command and the `status --porcelain` test stay; the restated location and branch conditions leave, since the safe set (C008) owns them. Without `--force` git itself refuses a dirty tree, which is the safety this step rests on. Lands at line 23 (section 43's close) as "If it has a worktree the safe set admits and that tree is clean (`git -C <path> status --porcelain` is empty), `git worktree remove <path>` without `--force`.", the location bound 'under `.claude/worktrees/`' having left for a pointer at the safe set, which owns it, after round 1's blind lens read the bare clause as removing any clean worktree; C014's and C016's sentences on the line are unchanged.
- passage: If the safe set admits its worktree, remove it

### C016
- key: Delete the branch with `git branch -D <name>` after the worktree step.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:23
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 1: `-D` is safe only because the trigger was tightened to verified-merged membership.
- verdict: keep
- reason: The doctrine's stop-for-a-yes does not bar this delete: the ownership map assigns what may be deleted without asking to this skill, the operator's Chapter 4 ruling licensed the auto-reap, the SHA from step 4 is the rollback, and test/probes/merged-plan-branch-delete-at-the-end-of-a-run.md resolves the moment to delete without asking. The `-D` (not `-d`) is deliberate: the worktree removal has already happened and the merged check was done in step 3.
- passage: then `git branch -D <name>`.

### C017
- key: Report in two parts: what was reaped, and what was left for the operator with the reason.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:24
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Goal ("reporting what it removed with an undo and listing anything unmerged or dirty for Scott to decide").
- verdict: keep
- reason: The two-part report is the blast-radius gate's shape: the left-for-you half hands every non-verified delete to the operator, and no hook produces this report.
- passage: 5. Report in two parts:

### C018
- key: In the Reaped part, list each branch and worktree removed with `restore: git branch <name> <sha>`.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:25
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Approach (`git branch <name> <sha>` brings a reaped branch back).
- verdict: keep
- reason: This is the report's owner of the restore line; Hard rule 4 (C033) retires as its third statement. The why, kept here: a reaped branch's commits are already on the integration branch, so recreating the ref at the recorded SHA restores it fully.
- passage: - **Reaped:** each branch and worktree removed, with `restore: git branch <name> <sha>`.

### C019
- key: In the Left-for-you part, list with reasons any branch whose upstream is gone but is unmerged, any likely-stranded branch ahead of the integration ref whose PR merged, any unmerged branch, any dirty worktree, and any reapable-looking worktree outside `.claude/worktrees/`.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:26
- provenance: 971042a 2026-06-23 installed the list (Chapter 1's demotion of "upstream gone" to report-only); 9b562c0 2026-06-23 added the stranded case per the merge-strand-guard plan Section 2.
- verdict: keep
- reason: Each category is a class whose delete could lose commits (squash-merged elsewhere, abandoned, stranded, dirty, or the operator's own worktree), so each is reported and held; the gate is blast-radius and stays.
- passage: **Left for you, with the reason:** a branch with its upstream gone but unmerged; a branch ahead of the integration ref whose PR merged, likely stranded (see Stranded Branch Recovery); any other unmerged branch; any dirty worktree; any reapable-looking worktree outside `.claude/worktrees/`.

### C020
- key: List the left-for-you items and do not delete them.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:26
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 1 and Out of Scope ("Reaping unmerged or abandoned branches automatically... may hold unsalvaged work").
- verdict: keep
- reason: A blast-radius gate on an unrecoverable delete; it governs the report while C030 governs the delete license, so the two are not one rule twice.
- passage: List them and delete none.

### C021
- key: Show a suspected stranded branch's commits with `git log origin/<integration>..origin/<branch>` and recover them via a new doc PR before deleting.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:26
- provenance: 9b562c0 2026-06-23, the merge-strand-guard plan Section 2 (flag an ahead-and-merged branch as a likely strand), written when the stranded remote branch still existed; c800e05 2026-06-26 then defined stranded at intake as remote-gone and added the recovery section.
- verdict: rewrite
- landed: 617317a section 43
- reason: The bullet's `origin/<branch>` form does not resolve for a branch whose remote is gone, which is the case the intake paragraph and the nudge hook define; the recovery section's `<integration-ref>..<branch>` form works either way, so the bullet keeps its detection condition and points at that section for the command and the route. Lands at line 26 (section 43's close) as "(likely stranded post-merge commits; recover them under Recovering a stranded branch below)", the detection condition before it unchanged; C019's and C020's sentences are unchanged.
- proposed: (via A029) Replace the parenthetical's command and abbreviated route on line 26 with a pointer at the recovery section, keeping "ahead of the integration ref and whose PR has already merged" as the detection condition.
- baseline-test: yes
- passage: a branch ahead of the integration ref whose PR merged, likely stranded (see Stranded Branch Recovery)
- flag: stale

### C022
- key: Recover a stranded branch's commits before deleting it.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:30
- provenance: c800e05 2026-06-26 (the diff, not the message), as the manual recovery the merge-strand-guard plan left out of scope ("Auto-recovering stranded commits... Scott releases it").
- verdict: keep
- reason: Branch-hygiene owns recovering stranded commits per the ownership map; the lead-in is three words and the executable condition is step 5, so there is nothing to compress. The delete of a stranded branch is the one act in this skill that destroys commits held nowhere else.
- passage: Recover a stranded branch's commits before deleting it:

### C023
- key: Confirm the stranded commits with `git log --oneline <integration-ref>..<branch>`.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:32
- provenance: c800e05 2026-06-26; the nudge hook (plugins/grimoire/hooks/branch-reaper-nudge.js line 151) names the same command.
- verdict: keep
- reason: The local-pair form is the one that works whether or not the remote branch survives, which is why the report bullet (C021) now points here rather than carrying its own.
- passage: 1. Confirm the stranded commits: `git log --oneline <integration-ref>..<branch>`.

### C024
- key: Branch fresh from the current integration ref with `git switch <integration-ref> && git switch -c <branch>-recover`, or cherry-pick onto a new branch off it.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:33
- provenance: c800e05 2026-06-26, applying the merge-strand-guard freeze rule (never reopen the merged branch) to recovery.
- verdict: rewrite
- landed: 617317a section 43
- reason: Flipped from keep to rewrite at the corpus rewrite's finishing fix round: `git switch <integration-ref>` fails on the remote-tracking refs line 14 names (probed in a throwaway clone, `git switch origin/main` exits 128 with "a branch is expected, got remote branch"), so the command is the one-command form below, which exits 0 and tracks the ref. The phrase "Branch fresh from the current integration ref" is an INTEGRATION_EXEMPT anchor in test/doctrine-parity.test.js, whose note records an open backlog decision on the recovery path's gate; the anchor phrase stays.
- proposed: `git switch -c <branch>-recover <integration-ref>`
- passage: 2. Branch fresh from the current integration ref: `git switch -c <branch>-recover <integration-ref>`.

### C025
- key: Never reuse the merged branch, which is frozen.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:33
- provenance: c800e05 2026-06-26, restating the freeze rule the merge-strand-guard plan (9b562c0 2026-06-23, Section 1) installed in the doctrine and finishing-work: after a fast merge every later push to the branch strands with no signal.
- verdict: keep
- reason: The whole rule lives in the doctrine and finishing-work, which bind a merged branch rather than one merely up for merge (ruling 27 of the corpus rewrite's rulings batch, docs/backlog.md 2026-09-13), so this eight-word warning names the same branch the owner freezes and stands unchanged; it is the pointer-sized form a non-owner keeps, and step 2 is not safely executable without it. The push guard (plugins/grimoire/hooks/merged-pr-push-guard.js) blocks the push but not the `git switch` back, so the prose still has work to do.
- passage: Never reuse the merged branch, which is frozen.

### C026
- key: Bring the commits over with `git cherry-pick <sha>...` per commit, or `git cherry-pick <integration-ref>..<branch>` for the range.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:34
- provenance: c800e05 2026-06-26.
- verdict: keep
- reason: No finding. "Bring the commits over" is a parity-test anchor (test/doctrine-parity.test.js INTEGRATION_EXEMPT); the cherry-pick produces new SHAs, which is why the original never enters the merged set afterward and why the contested delete row exists.
- passage: 3. Bring the commits over: `git cherry-pick <integration-ref>..<branch>`.

### C027
- key: Push the recovery branch and open a new PR against the integration branch.
- class: mechanic
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:35
- provenance: c800e05 2026-06-26, applying the merge-strand-guard route (a separate doc PR against the current integration branch, the agent authors and the operator releases).
- verdict: keep
- reason: Branch-hygiene owns the recovery procedure; the push guard blocks the wrong push but performs none of this step, so no machinery supersedes it. "Push the recovery branch" is a parity-test anchor. Under the doctrine's stop rule the push is read this way: once the session is on the recovery branch, that branch is the working branch it lands the recovery on, so the push and the new pull request are on the never-gated channel list (a push to the working branch; opening a pull request in the working repository), and the sentence about a push to another remote does not reach it, since the recovery branch sits on the working remote. That reading is inferred from the list's members rather than ruled.
- passage: 4. Push the recovery branch and open a new PR against the integration branch.

### C028
- key: Expect the push guard to allow the recovery branch push, because it has no merged PR, where re-pushing to the original would have been blocked.
- class: rationale-example
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:35
- provenance: c800e05 2026-06-26, describing plugins/grimoire/hooks/merged-pr-push-guard.js (installed 9b562c0 2026-06-23, merge-strand-guard Section 3).
- verdict: retire
- landed: 617317a section 43
- reason: Step 4 is complete without it and C025 already keeps a session off the blocked push. The fact, kept here: the guard denies a push only when the host CLI positively reports a MERGED PR for the target branch and fails open otherwise, so a fresh recovery branch always passes. Retired at section 43's close: the push-guard sentence is gone and line 35 reads "Push the recovery branch and open a new PR against the integration branch." alone, C027's sentence byte for byte and the parity anchor intact.
- proposed: Drop the push-guard sentence from line 35, keeping "Push the recovery branch and open a new PR against the integration branch." verbatim (a parity-test anchor); the guard's behavior lives in the ledger.
- baseline-test: yes

### C029
- key: Delete the stranded original only once its commits are safely on the recovery branch, ideally merged.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:36
- provenance: c800e05 2026-06-26.
- verdict: rewrite
- landed: 5a3a6c2 section 2
- reason: The condition is the only thing between recovery and an unrecoverable delete. Ruled 2026-09-13 (batch 2 ruling 21 part A of the corpus rewrite's rulings, docs/backlog.md): the delete is licensed on two conditions stated whole in the auto-delete rule (C030), the recovery branch pushed and `git cherry <recovery> <stranded>` printing no `+` line, which shows every stranded commit has an equivalent patch on the recovery branch; the "ideally merged" softener goes, since the cherry read is the check. Lands at line 36 as the pointer at the auto-delete rule's exception with both conditions named, which closes the contest the ownership map carried between this step and that rule.
- passage: 5. Delete the stranded original only under the exception in "The only auto-delete trigger".

### C030
- key: Auto-delete a branch only on membership in `git branch --merged <integration-ref>`, and never `git branch -D` one outside that set.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:40
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 1: the spec's upstream-gone trigger was demoted to report-only at build because a gone-but-unmerged branch may be squash-merged elsewhere or abandoned.
- verdict: rewrite
- landed: 5a3a6c2 section 2
- reason: All three sentences record that decision and no hook enforces it (the nudge hook never deletes). Ruled 2026-09-13 (batch 2 ruling 21 part A, docs/backlog.md): the second sentence gains the one licensed exception, the recovery-step delete on both conditions, the recovery branch pushed and `git cherry <recovery> <stranded>` printing no `+` line, stated whole here because this rule is what the ownership map now names as owner of that delete under Git acts; step 5 (C029) points here rather than stating a licence of its own, which is what closed the contest. Lands at line 40 with a sentence that one condition missing is a report, not a delete, so the exception fails safe like the rest of the rule. The section's review round 1 added the read that establishes "pushed" (`git rev-parse --verify origin/<recovery>` printing the local tip's hash, since a felt "pushed" is the judgment this rule exists to replace) and the precondition that the stranded branch is checked out in no worktree, which git enforces by refusing the delete and the text names so the refusal reads as a report rather than a reason to force. test/doctrine-parity.test.js pins the exception on its stable tokens: the scoping phrase and the two reads.
- passage: - The only auto-delete trigger is membership in `git branch --merged <integration-ref>`. Never `git branch -D` a branch outside that set, with one licensed exception: a stranded original once `git rev-parse --verify origin/<recovery>` prints the same hash as `git rev-parse <recovery>` and `git cherry <recovery> <stranded>` prints no `+` line. One condition missing is a report, not a delete. The branch must be checked out in no worktree, per `git worktree list`, and git's refusal is a report too. "Upstream gone" alone is a report, not a delete.

### C031
- key: Never run `git worktree remove --force`; report a dirty worktree instead of removing it.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:41
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Chapter 3 (dirty `git worktree remove` refused on the fixture).
- verdict: keep
- reason: Owner of the worktree half of the force-delete prohibition (C003 retires into it). Git refuses a dirty tree without `--force`, so this rule is what keeps a session from reaching for the flag that defeats that refusal.
- passage: - Never `git worktree remove --force`. A dirty worktree is reported, never removed.

### C032
- key: Never touch `develop`, `main`, `master`, the current branch, or a worktree outside `.claude/worktrees/`.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:42
- provenance: 971042a 2026-06-23, the branch-hygiene plan.
- verdict: rewrite
- landed: 617317a section 43
- reason: It omits the default branch that C009 names and adds the outside-worktree member C009 omits; C009 becomes the whole list and this line points at it, so no member is lost and each surface shows all of them. Lands at line 42 (section 43's close) as "- Never touch anything on the protected list under The safe set above.", line 16 carrying the whole list.
- passage: - Never touch anything on the protected list under Safe Set.

### C033
- key: Always print the restore SHA for every removal.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:43
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Approach.
- verdict: retire
- landed: 617317a section 43
- reason: The third in-document statement of the restore line, after step 4 (C014, record the SHA) and step 5 (C018, the report format), and the doctrine's rollback line is its general form. The why moves here: a reaped branch's commits are already on the integration branch, so every removal is recoverable by recreating the ref at the recorded SHA. Retired at section 43's close: Hard rule 4 is gone whole and the hard rules are three bullets; C014 (line 23) and C018 (line 25) carry the restore SHA.
- proposed: (via A023) Delete Hard rule 4 (line 43); C014 and C018 carry the restore SHA, and the recoverability reason lives in the ledger.
- baseline-test: yes

### C034
- key: Enable "auto-delete head branch on merge" in the repo settings to keep the remote side tidy.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:47
- provenance: 971042a 2026-06-23, the branch-hygiene plan, Approach paragraph 3 and Out of Scope ("a one-time repo-settings change Scott makes").
- verdict: retire
- landed: 617317a section 43
- reason: row 506 (Remote auto-delete setting note), dropped under the mechanism cut.
- proposed: Reword line 47 so the setting is named as the operator's one-time repo-settings choice, not an act the session performs.
- baseline-test: yes
- passage: The operator can turn on "auto-delete head branch on merge" in the repo settings, a one-time choice that keeps the remote side tidy. It is optional here (regular merges make `--merged` reliable on its own), but it removes the merged remote branches and gives the SessionStart nudge a second signal.
- flag: stale
- ruled: cut 2026-09-30

### C035
- key: Treat deleting the stranded original as safe once its commits are on the recovery branch, because the delete cannot strand anything.
- class: rationale-example
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:36
- provenance: c800e05 2026-06-26.
- verdict: retire
- landed: 5a3a6c2 section 2
- reason: Retired 2026-09-13 under batch 2 ruling 21 part A (docs/backlog.md): the sentence is gone from line 36, its licence now Hard rule 1's exception (C030) with step 5 pointing at it (C029). Its why lives here: a delete of a branch whose every commit has an equivalent on a pushed recovery branch strands nothing, which is what the `git cherry <recovery> <stranded>` condition establishes, so the delete is safe exactly when that read prints no `+` line and unsafe on any softer condition.

### C036
- key: For a branch with an open or merged pull request, take the integration branch as that pull request's base as the host reports it, read at the act.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:14
- provenance: docs/archive/claude-kit_stacked-pr-base_spec_v1.md section 1, 2026-10-06, on the operator's ruling of 2026-10-05 that queued plans stack and the architect's finding that the finishing skill resolved the integration branch to main for a stacked branch.
- verdict: keep
- reason: A stacked branch's base is its parent branch, so a strand-check against `origin/main` lists the parent's commits as stranded and a recovery would re-land work the parent already carries. The host's own record of the base is the only source that is right for a stacked branch, so it is read at the act with `gh pr view <branch> --json state,baseRefName` and the ref is `origin/<baseRefName>` after a fetch. A merged pull request's base is read the same way, since the strand-check runs after a merge. Where a branch has had more than one pull request the open one is the base, else the most recently merged. The read asks for the state because `gh pr view` also prints a closed pull request's base, exit 0, and `gh pr list --head <branch> --state all` shows each one's state and merge time where the single read prints CLOSED or MERGED, since that read cannot tell a session how many the branch has had. The nudge hook resolves only the C007 fallback with git and no host CLI, so the skill orders a re-read against the pull request base before any recovery of a branch the nudge flags. C007 holds the fallback, and C012 points the sweep at it (C037).
- passage: For a branch with an open or merged pull request, the integration branch is that pull request's base as the host reports it, read at the act.

### C037
- key: Test every branch in the sweep against the fallback ref, by ancestry.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:16
- provenance: docs/archive/claude-kit_stacked-pr-base_spec_v1.md section 1, 2026-10-06, from the section's review round 1.
- verdict: keep
- reason: The sweep runs one `git branch --merged` for every local branch, so it needs one ref, and a per-branch pull request base would test one branch against another branch's base. A branch whose work reached the trunk has landed whatever its base, so the fallback is a safe ref for every branch. A stacked branch whose work sits only in its parent waits until the parent lands, which delays a cleanup and never deletes unlanded work. C012 points step 2 here, and Hard rule 1 keeps its spelling. The test is ancestry, so it reads a merge-commit merge as landed. A squash or rebase merge leaves a landed branch reading unmerged, which keeps it, the safe direction, and the paragraph says so that a change of merge method knows what it touches.
- passage: The sweep below tests every branch against that fallback, by ancestry, since one ref serves every branch and a branch whose work reached the trunk has landed whatever its base.

### C038
- key: On a GitHub remote, treat a pull request base read that fails for any reason but no pull request as a stop, not a fallback.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:14
- provenance: docs/archive/claude-kit_stacked-pr-base_spec_v1.md section 1, 2026-10-06, from the section's review round 1.
- verdict: keep
- reason: `gh pr view <branch>` fails both where the branch has no pull request, printing `no pull requests found for branch`, and where `gh` is missing, signed out or offline, without that message. Read as a fallback, the second case resolves a stacked branch to the trunk, which is the stranded-parent failure C036 exists to prevent. The stop is scoped to a GitHub remote, since on any other remote `gh` fails for want of a GitHub host, and stopping there would end recovery that the fallback serves (C007).
- passage: On a GitHub remote, a read that fails for any reason but `no pull requests found` is a stop, not a fallback.

### C039
- key: Recover a stranded branch against its own integration ref.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:32
- provenance: docs/archive/claude-kit_stacked-pr-base_spec_v1.md section 1, 2026-10-06, from the section's review round 1.
- verdict: keep
- reason: The sweep's ref is the fallback (C037), but recovery acts on one branch, so it takes that branch's own base from the safe set. A stacked branch recovered against the trunk would cherry-pick its parent's commits too.
- passage: Recover a stranded branch's commits before deleting it. Here the integration ref is the stranded branch's own, per Safe Set:

### C040
- key: Take the fallback for a merged pull request whose base had already landed when it merged, unless the base is develop, main, master or the repo's default branch.
- class: rule
- source: plugins/grimoire/skills/branch-hygiene/SKILL.md:14
- provenance: docs/archive/claude-kit_stacked-pr-base_spec_v1.md section 4, 2026-10-06, on the architect persona's ruling from section 2's review round 4, narrowed by its consult ruling from section 4's review round 1.
- verdict: keep
- reason: A child merged into a parent after the parent landed, where the parent kept its branch, holds work that reached only the parent. The parent then carries the child's merge, so it is no ancestor of the trunk and the ancestor condition misses it, and a strand-check against the parent reads clean while the child's commits never reached the trunk. The `mergedAt` order is what separates that child from one merged before its parent landed, whose work rode the parent's landing, so the parent is its right ref: a squash-merged parent's child and a deeper stack's child both read clean against the parent. The order reads the governing pull request's own `mergedAt`, since `gh pr view` on a branch with several pull requests can pick one that never merged, and a null `mergedAt` would decide the condition. A base among the protected names is already an integration branch, so a fallback from it only swaps one integration branch for another and reads a hotfix stranded until a back-merge. `gh pr list` prints an empty list where the base has no pull request, so an empty list, like one holding no merged pull request, leaves the base governing, and a failed read takes the stop above. Residual: a long-lived branch other than the protected names, promoted to the trunk by pull request, reads as a landed parent between promotions, so work merged into it since its last promotion lists as stranded. No host or git fact tells the two apart. The list also matches by head name, so a base whose name an earlier, unrelated branch or a fork's head also used reads as landed too. Each error is a false stranded flag, which costs a re-read before recovery and reaps nothing, where the condition's absence was a false clean, which lets a reap lose work.
- passage: A merged pull request also takes that fallback where its base had already landed when it merged. A protected base never does: `develop`, `main`, `master` or the repo's default branch, which `gh repo view --json defaultBranchRef` names. Any other base had already landed where the governing pull request's `mergedAt` is later than every `mergedAt` that `gh pr list --head <baseRefName> --state all --json number,state,mergedAt` prints for the base's own merged pull requests. The governing pull request's `mergedAt` comes from the list row that governs. Where the base's list holds no merged pull request, the base governs.
