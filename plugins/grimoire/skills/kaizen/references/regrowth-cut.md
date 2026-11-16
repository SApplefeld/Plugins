# Regrowth Cut Run

Part of the kaizen skill: how a seat runs the regrowth cut of the kit's instruction text.

## What the Run Is

The regrowth cut is a cut of the kit's instruction text that repeats. It reads only what grew since each entry was last cut.

## When It Is Due

A cut is due where the `date` in `tools/corpus-compression/last-cut.json` on the fetched trunk falls in a calendar month before the current one.

## Who Starts It

A seat that writes kit plans starts a run by writing the run's plan where the cut is due. The plan passes the brainstorming skill's worth test on the operator's ruling of 2026-11-15 that the cut repeats, so its author asks for no new ruling on worth.

## What a Run Reads

`node tools/corpus-compression/regrowth.mjs` prints the entries that grew, largest first. An entry is a skill folder, summed over its files, or a single document outside the skill folders. Each entry is measured from its own base: the commit it was last cut at, or the state file's default commit where it never was. The run takes the first eight entries, which the `picked:` line names. Eight is the tunable figure. An entry a run does not take keeps its base, so a later run still reads it.

## Run's Plan

The plan is `docs/plans/claude-kit_regrowth-cut-<YYYY-MM>_spec_v1.md`, under the Branch-and-PR commit model. It has one section per picked entry, each `Model: opus` and `Locus: inline`. Each section's body is the fixed text below, with the entry's name and its base commit filled in. The author copies each base commit from the script's output, so no section reads the state file. One more section, numbered last, writes the state file. The plan takes the brainstorming skill's reviews as any plan does.

## Fixed Section Text

> For each corpus file of `<entry>` whose own word count grew since `<base>`, as `isCorpusPath` in `kit-size.js` counts one, which leaves out its rationale ledger, dispatch the `corpus-drafter` agent by the Agent tool, one at a time, on opus at effort medium, the pair the operator named for the drafter. The prompt names the file, its rationale-ledger heading and the base commit `<base>`, and no word target. The main thread lands the text and the rationale-ledger lines. Once the entry's files have landed, one `grimoire:prose-reviewer` and one `grimoire:blind-reader` read the entry's diff at dispatch table row "Round 1 pair", the row over an opus writer, which the drafter is, to check that no kept rule lost its meaning. A passage whose reason names a failure a record shows is kept or shrunk, never dropped. The section passes where the entry's word count is lower than at the section's open, or where the Chapter lists each passage added since `<base>` with its call and the reason it stayed. The caps move down by `kit-size.js sync`, as the writing-skills skill's size-budget rule states. No step of this section uses the Workflow tool.

A run never runs `tools/corpus-compression/workflow.mjs`, whose runs each need the operator's ask.

## State File

The run's last section rewrites `tools/corpus-compression/last-cut.json` whole. Each entry whose section closed takes as its base the commit on the plan's branch that added that section's Chapter, which holds the entry as cut and its caps as lowered. Every other entry's base is unchanged, and `date` becomes the day of that write. The host merges the pull request with a merge commit, so each base stays in the trunk's history.

## Stopped Run

A stopped run's plan and Chapters are its record. The state file moves on the trunk only when the plan's pull request merges, since the write rides that branch.

## Run Cost

The run's final Chapter records the dispatched agents' tokens, so a run, and any clock that starts one, is priced from a measured run.
