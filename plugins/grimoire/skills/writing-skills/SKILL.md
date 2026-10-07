---
name: writing-skills
description: "The kit's rulebook for authoring and amending behavior-shaping prose, from a skill to any curated document the kit ships. Use when creating a skill for this kit, editing one, or deciding whether a wording change to a behavior-shaping skill will actually change behavior. Also use when amending curated prose the kit ships: a skill, an agent charter, the output style, a README, a plan doc, or a doc under docs/, or deciding whether a sentence already in one still earns its place. Triggers: adding a new SKILL.md, reworking a skill's rules, correcting a claim a curated document states, a prose audit of a curated document, a skill that reads well but agents ignore under pressure, or a kaizen change to the kit's own skills."
---

# Writing Skills

A skill is behavior-shaping prose, not documentation. If it does not change what an agent does under pressure, it is decoration.

## When to Create a Skill

- **Create when** the technique is non-obvious, recurs across efforts, and is general. A single project's convention goes in that project's CLAUDE.md.
- **Do not create** for a one-off, a restatement of standard practice, or anything a hook or regex can enforce.
- **The kit stays lean.** A new skill must beat one more paragraph in an existing skill. When in doubt, fold it in rather than add a file.
- **The size budget is a ledger rather than a ceiling.** A file that grows raises its cap in `test/size-budget.json` in the same change, and one that shrinks lowers it. Move the caps with `node <plugin-root>/scripts/kit-size.js sync --repo <the project's root> <path>...`, naming the files the change touched, a new file's first cap included, tracked or not. The bare form with no paths belongs to an audit over a clean tree. A reviewer weighs only whether the added words earn their place, and a rewording takes the shrink where one is available.

## Anatomy

- One SKILL.md in the kit's voice: direct, opinionated, anti-dogma. Add a reference file only when the body outgrows the kit's other skills, gated the way csharp-style and sql-style gate theirs.
- **Frontmatter: always quote the description.** `name` and `description` are the two fields that matter.
- Body: the principle, the rules that carry judgment, the antipatterns. Tables for what gets scanned, prose for the why, and a flowchart only for a decision the agent might get wrong.
- **One owner per rule.** The doctrine's one-owner bullet and its ownership map own the principle and the forms a mention may take. When editing a rule, grep its key phrases across the kit and fix the owner, not the nearest copy.
- Point at `curating-docs/SKILL.md`'s "Plan Doc Machine Contract" section for the plan-doc header and structure, never restating its lines.

## Description Field

Open with a third-person clause saying what the skill does, then "Use when..." and its symptoms, and stop. Do not summarize the skill's process there. Write "the operator", never first- or second-person pronouns outside quoted utterances. Stay within 1,024 characters. `test/skill-description.test.js` holds the limit, the opening and person words.

## Rule Forms by Failure

Name the failure first, then pick the form that fixes it. The form that fixes one failure backfires on another.

| What fails? | What fixes it? | What backfires? |
|---|---|---|
| Knows the rule, skips it under pressure | Prohibition, rationalization table and red-flags list | Soft "prefer..." guidance |
| Complies, but the output is wrong-shaped (bloated, buried, restated) | Positive recipe: what the output IS, its parts in order | Prohibition list ("don't restate") |
| Omits a required element | Structural slot: a REQUIRED field in the template it fills | Prose reminder near the template |
| Behavior should depend on a condition | Conditional on an observable predicate ("if the brief exists, reference it") | Unconditional rule plus exemption clauses |

Three rules govern any rule you write:

- **No nuance clauses.** "Don't X unless it matters" reopens the negotiation. Write a real exception as its own conditional on something observable.
- **Exemption clauses do not scope.** Where part of the output must be exempt, restructure so the rule cannot reach it.
- **Close every enumeration with its class.** Where the list ends, state its class ("the table is instances, not the boundary"; "the set is closed"), so a novel variant meets the rule.

## Checkable Facts

Framing a fact so the reader can check it is the doctrine's "A claim is written in the form a reader can check" bullet.

- **A list drawn from observed instances is stated as open unless a contract closes it.** Closure comes from a contract (a schema, an enum, a validated surface with a published shape), never from the sample agreeing with itself. So write the list as open and say what would close it, or cite the contract that already does.

## What a Sentence Must Earn

Whether a sentence belongs is the doctrine's "Documents ship the current state; the journey lives in git" bullet's call. An accepted lesson lands by the kaizen skill's rewrite-not-append rule (`skills/kaizen/SKILL.md` under the kit plugin root).

Curated prose in the kit's own voice meets three sentence-shape bars:

- **One idea.** A sentence is one idea, about twenty words. A rule and the bound that limits it are two sentences, the bound right after the rule. They share one sentence only where the split would leave the rule readable alone. A count past twenty is the diagnostic that finds a second idea, read per sentence and never as a target. A paragraph makes one point, or says why its parts must be read together.
- **The literal phrase.** Where a literal phrase for the thing exists, the sentence uses it. A metaphor stands only where it is the established term, and elsewhere it is mannered prose, flourish in place of direct statement, fixed by the literal phrase.
- **A pointer where another site owns the rule.** The forms a mention may take are the doctrine's one-owner bullet's, and this bar adds none.

The three are instances of one class: prose that costs the reader more to read than it changes for them. A form none of them names is inside the bar.

## Correcting a Curated Claim

**When an amendment corrects a claim a curated document states, the edit unit is the paragraph, never the sentence.** Re-derive the whole paragraph from the corrected claim. Check the claim's other carriers: the neighbouring clauses that qualified or restated it, and any sibling surface stating the same behavior. The unit is the claim on every surface carrying it, whether or not anything here names that surface. Carriers include a doctrine parity copy, the output style's register block, an agent charter, a test's assertion message, a memory record and a README's payload map, and that list is not the boundary. An amendment that corrects no claim, such as a typo fix, an added bullet or a label rename, takes whatever edit it needs.

An insertion anchored on a block's tail, or on the next entry's first line, restores every byte of that anchor in the replacement. It then re-greps the neighbour's lead-in, with a control at HEAD proving the pattern matches the intact form.

A carrier on another surface is not automatically yours to edit in place:

- Where the one-owner rule applies, fix the owner rather than the nearest copy.
- A deliberate byte-identical set lands every copy in one edit or none, and the set is as large as the parity pin says.
- A deliberate restatement across surfaces the section's scope already covers lands on all of them in the same edit.
- A carrier in a file the section's `Files in scope:` never listed takes the fix-round step's route in `skills/executing-work/SKILL.md` under the kit plugin root, never an in-place edit.

A carrier fitting none of these is named as such and routed deliberately, never edited in place by default.

## Testing a Skill

An untested skill is a guess. Test it by watching an agent with and without the wording:

1. **RED:** give a fresh subagent a realistic task that tempts the failure, without the new guidance. Watch it fail and record the rationalization verbatim. If it does not fail, there is nothing to fix, so stop.
2. **GREEN:** add the minimal guidance for that specific failure, and re-run until the agent complies.
3. **REFACTOR:** counter each new loophole and re-run until it holds. For discipline rules, combine pressures such as time, sunk cost and authority, since single pressures are weak tests.

Run several reps, since one sample lies. Read every flagged result yourself, since template echoes masquerade as both failures and successes. This standard covers any change to behavior-shaping content, the kit's own skills included.

## Probe Runner Pair

In the kit's own repository, a change to a passage a probe's scenario turns on, in a file that probe's shape under `test/probes/` names, runs the probe runner's before-and-after pair. Match the changed and untracked paths since `<sha>` against the shapes' `files:` lists, then the changed hunks against those probes' scenarios. A hunk no scenario turns on runs nothing.

For a `ruled` probe, the pair stands in for the reps as the RED and GREEN. For a `proposed` probe, only the after leg runs, as evidence for the operator's rulings batch, and the reps still run. A before leg that matches is not step 1's nothing-to-fix case.

The before leg is `node tools/probe-corpus/run.mjs --only <moments> --before <sha>`, over the `ruled` moments the check kept. The after leg is the same command without `--before`, over every kept moment. `<sha>` is the parent of the change's first commit resolved to a sha, or `HEAD` for an uncommitted change.

Read each row by `tools/probe-corpus/README.md`'s "What a row counts for" section, after the re-runs finishing-work's step 6 directs. A before-leg mismatch the after leg matches is the repair. A match on a moment the change meant to move is a finding, and any other match held. A pair that errors again stands in for nothing, and the reps run. Rows from a shape naming no changed file are no reading at all.

The intent test covers a ruled probe's after-leg mismatch the before leg lacks. A move the change intended is a re-ruling to ask the operator for, and any other is a finding.

The pair runs once at the section's close over its whole change, never at each fix round, and inside a finishing pass only finishing-work's step 6 runs the set. A change whose only shape-named files are the repo's `home/*.md` files is seen by neither leg, so it takes the reps with the cache staging below. A matching leg pair is one sample. Record the reading, or both where a pair ran, on the line executing-work's Chapter template holds for it in `Decisions / Surprises`, or in the close-out status where no section Chapter exists.

## Doctrine Probes

**A doctrine edit is invisible to same-session subagents.** A GREEN probe for a doctrine change runs in a fresh session (a headless `claude -p`), never as a subagent of the session that made the edit. Do not stage probe wording in `~/.claude/grimoire-doctrine.md`. Where the probe pair does not supply the GREEN, stage the candidate wording in the installed plugin cache's copy of the operating-instructions skill for the probe run and restore it after. The real change ships through the normal commit and goes live when the plugin updates.

**Doctrine-adjacent rules have a contaminated RED.** Where the harness's subagent inheritance is off, a RED is genuine. Where it is on, absence of failure is weak evidence, not proof the rule is dead weight. Such a rule may ship on its point-of-action value, surviving compaction and reaching contexts the doctrine does not, and the record says it stands on that rationale. A rule with neither a reproduced RED nor that rationale is left out.

## Antipatterns

- A harness-injection fact stated as unconditional ("subagents load X") when it hinges on a user setting. State the safe assumption, and where the fact must be stated, name the setting it depends on.
