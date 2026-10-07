---
name: curating-docs
description: "Keeps a project's docs/ folder a curated library rather than an attic. Use when a plan reaches Complete during finishing-work, when a new plan is written that should be indexed and cross-referenced, or when asked to tidy, retrofit, or reorganize a project's docs/ folder. Symptoms: completed plans piling up in docs/plans/, a backlog doc that only grows, plans that never reference each other, a docs/ tree with no index."
---

# Curating Docs

A plan is finished when it has moved to the archive, the backlog is pruned, related plans point at each other, and the index reflects reality. Closing a plan is not finishing it.

## Docs Taxonomy

Three zones, each with one job, plus one living document: the backlog.

| Location | Holds | Discipline |
|---|---|---|
| `docs/` root | Stable about-the-solution docs (architecture, security model) and the README index | Updated in place as the solution changes |
| `docs/plans/` | Active plans only (open or in progress) | A plan leaves the moment it is Complete or abandoned |
| `docs/archive/` | Finished and abandoned plans (Chapters intact) and dated backlog snapshots | Immutable history; nothing here is live |
| `docs/backlog.md` | The living handoff doc for cross-effort next-steps, active items only | Pruned-live: completed items move to a dated snapshot |

## Archiving a Completed Plan

Run this close path at close-out, in order:

1. Confirm `Status: Complete` (or abandoned) and a final Chapter. If the plan is not done, stop.
2. Move the file with `git mv docs/plans/<file> docs/archive/<file>` in a git repo, or a plain move otherwise. The Chapters travel untouched. Then `git add` the moved file again whenever it carries unstaged edits. `git mv` stages the index content, not the worktree content, so a doc finalized and then moved commits pre-finalization unless re-added. The `RM` pair against the file in `git status --short` is the tell.
3. Repoint the plan's own relative links, before or right after the move. An archived sibling reached as `../archive/<file>` from `plans/` is `<file>` once the plan is itself in `archive/`. Grep the moved file for `../archive/` and fix every hit.
4. Cross-reference. If the plan built on or superseded another, link both through a `## Related` section and mark a superseded plan in its header. Act on any cross-reference gap `docs-curator` flagged. The pointers run one way when the other plan is already archived: the moving plan gets the `## Related` section and the archived one is left alone.
5. Prune the backlog, per Backlog Pruning below.
6. Refresh the index. `docs/README.md` and `docs/plans/README.md` both drop the plan from their active list and reflect the archive. The most-recent chain is the `Most recent:` and `Before it:` entries on the line opening `Completed plans are in`. Where either index carries it, both name the same four most recently archived plans. An archival prepends the newly closed plan and drops the oldest.

Archive in the same close-out that finished the work, never later or in a batch.

## Registering a New Plan

This is the create path. Run it when `brainstorming` writes a new spec, before `executing-work` takes it:

1. Add it to the active-plans list in `docs/README.md`.
2. If it builds on or supersedes another plan, cross-reference it per the close path's step 4. The new plan takes the moving plan's part there, the archived-plan carve-out included.
3. Add any cross-effort next-steps that surfaced during design to `docs/backlog.md`.

## Backlog Pruning

Move a done item into the quarter's snapshot at `docs/archive/backlog-YYYY-QN.md`, creating it if absent and appending within the quarter. Do not strike items through in place.

The prune pass is also the aging check. Name every active item parked more than 90 days ago, with its date, for a promote, retire or keep call. Promote it: spec it now. Retire it: move to the snapshot with the reason. Keep it: write the fresh adjudication date ahead of the original, `(YYYY-MM-DD, parked YYYY-MM-DD)`, with the reason it stays. An undated active item is past the threshold: give it its parked date from git history, or today's marked `backfilled`, and adjudicate it in the same pass.

The check also runs without a close-out. When the session-start block reports an oldest item past the threshold and no close-out is near, offer the prune pass in one line. 90 days is the tunable knob, aligned with the quarterly snapshot cadence.

## Retrofitting an Existing Tree

When asked to tidy or retrofit a `docs/` that predates this structure:

1. **Audit, read-only.** List every doc, read each plan's `Status` header, and classify each: active plan, completed or abandoned plan, about-the-solution doc, or stray.
2. **Propose the migration.** Name the plans that move to the archive, what the index and backlog will hold, and which READMEs get seeded. Move nothing until it is confirmed. Where a plan has not already made that call, the stop is the material decision executing-work's blocker set names.
3. **Apply on approval.** Create the zones and READMEs from the templates, `git mv` the completed and abandoned plans into the archive, seed the index and backlog, and report what moved. Never delete a file. Relocate it instead.

## Plan Doc Machine Contract

A plan doc's header and structure are not just kit convention. An external engine, the AI OS Spine, parses every plan doc to drive its own fleet. Its parser is case-sensitive and anchored to the start of the line, so a reasonable-looking rewording parses as absent rather than as a variant. Several rows also carry a load-bearing value shape, not just a key shape. A line with the right key and a value the engine does not recognize is worse than a missing line, because it silently substitutes a default rather than failing loud. This is the frozen v1 contract:

| Line or heading | Exact shape | Value rule |
|---|---|---|
| Title | `# <Title>` (first H1) | free-form |
| Status header | `Status: <value>`; the first occurrence above the first `##` heading is the one read | must equal `Complete` exactly, whole string and case-insensitive, for the plan to read as terminal. `Complete (archived)` or any other trailing text does not terminate. Three values carry a kit-side meaning beyond that: `In Progress`, `Complete`, and `Ready`. `Ready` marks a plan authored and parked before any run starts. It is non-terminal under this row's rule exactly as every other non-`Complete` value is, so it is a v1 value rather than a v1 change. It is a pre-run value under the kit's own rule: a kit-driven run sets the header to `In Progress` as part of starting. That is `executing-work`'s instruction to that run and not a guarantee this contract establishes. A worker under an external engine leaves the header to its engine, per that skill's External-engine stand-down |
| Commit Model header | `Commit Model: <value>`; the first occurrence above the first `##` heading is the one read (a Chapter's own `Commit Model:` line, required by `executing-work`'s template, is a later occurrence and is ignored) | must open with `Commit-and-Push`, `Branch-and-PR`, or `Review-Only`, case-insensitive, trailing prose tolerated. Any other leading token, or an absent header, parks the run without dispatching. `Review-Only` itself never dispatches. Under `Branch-and-PR` the trailing prose is also load-bearing. Prose naming a pull request per section opens each section's pull request ready for review. That prose reads `per-section PR` or `one PR per section`, in either word order, with `pull request` spelled out or not. Every other reading, absent prose included, is the draft-per-plan default. Under it the engine opens one draft pull request at the first section close, refreshes it each section, and flips it ready at the finishing pass. A kit session opens its own pull request at `finishing-work`'s close where none is open, marks it ready for review and arms auto-merge, per that skill's Apply the commit model step. Prose about commits rather than pull requests, such as `one commit per section`, does not name the cadence and leaves the default in force |
| Disjoint header | `Disjoint: <value>`; the first occurrence above the first `##` heading is the one read | `yes`, case-insensitive, declares the plan independent of whatever else is in flight. Anything else, an absent header included, means not disjoint, which is the safe default. It is read only to decide whether the engine may start this plan beside another that is blocked on something outside its control. A wrong `yes` therefore surfaces as a merge conflict at the pull-request gate rather than as an engine error |
| `## Sections of Work` heading | the literal text `Sections of Work` on a `##` line | bounds the block. Any other `##` heading inserted inside it ends the block early, silently dropping every later `### N.` section |
| Section heading | `### N. <Title>` (one or more digits, a period, whitespace) inside `## Sections of Work` | free-form title |
| Section model line | `Model: <value>`, the first one following a section heading | must be exactly `haiku`, `sonnet`, `opus`, or `fable`, trimmed and case-insensitive. Anything else, including a decorated value like `fable (inline)` or a trailing rationale, silently dispatches at a default sonnet model with no error. Whether a section is dispatched or built in the main thread rides on its own `Locus:` line. No consumer parses that line, precisely so the tier value can stay a bare token |
| `## Chapters` heading | the literal text `Chapters` on a `##` line | bounds the block, and also marks where the approval-scoped fingerprint stops. Renaming it makes that fingerprint cover the whole document, so every ordinary Chapter append then reads as approval drift |
| Chapter heading | `### Chapter N` (only the word and the number are parsed; a trailing ` - <date>` is convention, not contract) inside `## Chapters` | N is one or more digits |
| Chapter completed line | `Completed: <value>`, the first one in the Chapter | must start with the section number followed by a period or a space, or equal the section title exactly, case-sensitive and never a substring. Anything else leaves the section permanently open. Check an existing Chapter against these three forms before assuming it registers. A phrasing like `Completed: Section 1, <title>` matches none of them |
| Chapter next line | `Next: <value>`, the first one in the Chapter | free-form |

A plan headed `Complete (archived)` or with any other text after `Complete` still reads complete to the session-start push and the personas plugin's documentation check, so write the value exactly.

The Spec Format in `skills/brainstorming/SKILL.md` and the Chapter format in `skills/executing-work/SKILL.md` instance these rows.

Changing the shape or value rule of any row is a coordinated, versioned change with the OS repo, never a drive-by edit to plan-doc prose. A value a row's existing rule already decides, `Ready` under the Status row, is not such a change.

None of `## Intent`, `## Assumptions` and `## Dispatch Authorization` appears in any row above, so a plan gains any of them with no contract version change.

`## Dispatch Authorization` goes **above** `## Sections of Work`. `## Intent` and `## Assumptions` go outside `## Sections of Work` and above `## Chapters`. A misplaced heading truncates the parse silently. Inside `## Sections of Work` it drops every later `### N.` section, and after `## Chapters` every Chapter below it stops registering.

A `## Dispatch Authorization` section records a plan run's approval: who approved the run, when, and which sessions the grant covers, by default "any session holding this plan". It is an approval, never an instruction to start the run. A plan arriving by peer message runs under it once the grant stands as the peer-sessions skill states, by a trace to the operator or a chain handoff. The peer-sessions skill owns the trace, the chain handoff, the message's standing and the reply states. The section supplies no live steering, so anything the plan does not cover goes to the operator.

Adding any of these headings to an approved plan mid-run is an edit above `## Chapters`. Make it deliberately and record it in the Chapter, per the freeze rule in `skills/brainstorming/SKILL.md`'s spec format.

## Templates

Seed the README, index, and backlog skeletons from `references/templates.md` rather than inventing a new shape per project.

## Antipatterns

- Forking a parallel copy of a doc instead of updating it in place.
- Editing an archived plan for new work. New work gets a new plan, cross-referenced to the one it builds on.
