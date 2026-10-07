# Docs Library Templates

Seed a new or retrofitted `docs/` library from these skeletons. Replace `<project>` with the project name. Keep the kit's house style, which the doctrine's Style section owns.

## `docs/README.md`: Index

```markdown
# <project> Docs

## Folder map

- **Root (`docs/`)** holds this index and stable solution documents.
- **`plans/`** holds active plans only. See `plans/README.md`.
- **`archive/`** holds finished and abandoned plans and backlog snapshots. See `archive/README.md`.

## Living documents

- **`backlog.md`** is the living handoff and next-steps doc.

## Active plans

(List active plans, or "None at present.")

## Archive

See `archive/`.
```

## `docs/plans/README.md`

```markdown
# Active Plans

## Rules

- A plan moves to `../archive/` the moment it reaches `Status: Complete` or is abandoned.
- Naming: `<project>_<content-type>_v<n>.md`. Increment the version rather than overwriting a prior one.
- The `Status` header drives the lifecycle. `Ready` plans surface as authored and parked, with no resume push. `In Progress` plans surface for resume. A `Complete` plan still here is flagged as unarchived.
- When a plan relates to or supersedes another, cross-reference it in a `## Related` section.

## Current

(List active plans, or "None at present.")
```

## `docs/archive/README.md`

```markdown
# Archive

## Contents

- **Completed and abandoned plans**.
- **Backlog snapshots** (`backlog-YYYY-QN.md`).

## Rules

- Edit no archived plan, and delete nothing here. New work gets a new plan in `../plans/`, cross-referenced to the archived plan it builds on or supersedes.
```

## `docs/backlog.md`

```markdown
# Backlog

Active cross-effort next-steps and handoffs only. Per-plan history stays in the plan's Chapters.

Every active item carries the date it was parked: `- **<item> (YYYY-MM-DD).** <body>`. Items age from the first date on their line, so a keep at the aging check writes its fresh date first and keeps the original beside it (`(2026-11-07, parked 2026-05-01)`). An undated item is past the threshold by definition, so the prune pass backfills its date and adjudicates it in the same pass.

## Active

- (Active next-steps and handoffs. Each item takes the dated shape above.)

## Snapshots

A done or retired item moves to `archive/backlog-YYYY-QN.md`, never struck through in place.
```

## Backlog Snapshot: `docs/archive/backlog-YYYY-QN.md`

```markdown
# Backlog Snapshot YYYY QN

Items moved out of `../backlog.md` this quarter. Append-only within the quarter.

- YYYY-MM-DD: <item, one line, with the outcome>
```
