# Ownership Map

The doctrine's "One owner per moment, and the map names it" bullet states the rule this map serves, and its Which Text Governs section states the ranking.

A moment is the situation a session is in. Its owner is the document whose text is the rule there. "Doctrine" means the operating-instructions skill body and its mirror, one text. A hook, script or test in the owner column enforces a rule the named prose owns.

Amending: a row changes when ownership moves. It lands in the same change as the prose that moves. A new skill adds its rows. A retired skill's rows leave with it. A moment two documents govern with no stated precedence goes under Unowned or contested, never silently into one owner's column, because assigning an owner is the operator's ruling.

## Intake and Design

| Moment | Owner |
|---|---|
| Designing a non-trivial change: scope check, questions, spec | `brainstorming` |
| A plan's `## Intent` record, and a ruling after the spec ships | `brainstorming` (step 9, and its freeze paragraph for a later ruling) |
| A section's model tier, and the tier bands | `brainstorming` |
| The scout sweep deriving a section's files in scope | `brainstorming` |
| Reading a spec against its Goal before approval, the `[unrefusable-frame]` question included | `brainstorming` (step 10, plan review) |
| A hard-to-reverse architecture fork | `design-council` |
| A verdict on a decision framed with the operator's own preference | doctrine (Match my precision) |
| Gaps at intake, and how each is routed | doctrine (Enumerate the gaps at intake) |
| A plan doc's name, format, `Status` lifecycle and `Commit Model` values, and the `docs/` taxonomy | `curating-docs` |
| Archiving a plan, pruning the backlog, refreshing indexes | `curating-docs` |

## Execution

| Moment | Owner |
|---|---|
| The section loop and its completion contract | `executing-work` |
| The add-decision before building, and the design stop it fires | `executing-work` (step 1's open and step 4) |
| A dispatch brief's fields, and the directives forwarded verbatim | `executing-work` |
| Scouts: banding, return contract, limits | `executing-work` |
| Review roster (lens tiers, `Audience:` pair, model), every dispatch's effort | `executing-work` (step 3's dispatch table, step 4) |
| The review-round backstop: its bound, its ladder, the classes that never freeze | `executing-work` (step 4's backstop paragraph) |
| Whether a fix delta owes its own review round | `executing-work` (step 4's fix-delta bar, and step 3 for the below-bar judgment) |
| What a security Critical must cite from a `## Threat model`, and what citing buys | `executing-work` (step 4's advisory paragraph) |
| A `## Threat model` section's four parts, and the security lens where none exists | `security-reviewer` |
| A section's `Standing Brief Amendments` block | `executing-work` |
| Which surfaces a subagent may write | `executing-work`, enforced by `hooks/docs-write-guard.js` |
| Replacing a dispatched agent for a reason other than a stall | `executing-work` |
| Awaiting a background dispatch: `WAITING:` turn end or synchronous call | `executing-work` (the dispatch row, step 1's wait-shape bullet) |
| A quiet dispatched agent: probe, wedge hallmark, cadence, the wakes it is evaluated at, windows | `finishing-work` (the unavailability rule) |
| The capacity reading before a `fable` override dispatch | `executing-work` (step 1) |
| The Jev promise check before review, its re-read line and its Chapter line | `executing-work` (step 2) |
| The compaction boundary a section close declares | `executing-work` (step 8) |
| Consult triggers and mechanics | `consult` |
| Weighing a review finding or operator correction before acting | `responding-to-review` |
| Root-causing a failure | `systematic-debugging` |
| Whether a change earns a test, which tests retire, test shape and cost, lane mechanics, the red protocol | `testing-discipline` |
| Which lane each gate moment takes, and the delta against its baseline | doctrine (After each step, run the lane) |
| Starting a heavy process on a shared machine | doctrine (One heavy process at a time is a per-machine budget) |
| Hunting one thing in a large file | doctrine (When you are hunting for something in a large file) |
| C# and T-SQL house style and their outline recipes | `csharp-style`, `sql-style` |

## Finishing

| Moment | Owner |
|---|---|
| The finishing pass: QA, reviews, goal read, docs curation, memory close, drift routing, close-out | `finishing-work` |
| The pull request at finishing: opened if none is open, marked ready, auto-merge armed, integrated per commit model | `finishing-work` |
| A record only on a merged PR branch: the strand-check, and the reap of the plan's merged branch | `finishing-work` (at the close, and invoking the reap) and `branch-hygiene` (at session start, and the reap's mechanics) |
| Reaping merged branches, recovering stranded commits, what may be deleted without asking | `branch-hygiene` |
| The store's record of the effort, the after-query, decay, the applied-stamp ledger | `memory-system` |

## Git Acts

| Moment | Owner |
|---|---|
| Whether this session may commit or push, and the form an authorization takes | doctrine (Name the rollback and stop for a yes; Which Text Governs) |
| `Commit Model` header values, and the parked state an unknown value produces | `curating-docs` |
| Where the commit and the push land in the section loop | `executing-work` |
| Staging on a shared checkout | doctrine (Stay in scope; On a checkout another session may commit to) |
| The commit message's three layers | doctrine (A commit title is the index line) |
| The memory store's own commits and pushes: sync path, allowlist, lock | `memory-system` |
| Deleting a stranded branch after its commits are recovered | `branch-hygiene` (Hard Rules) |

## Coordination and Seats

| Moment | Owner |
|---|---|
| Reading the roster, messaging a peer, acting on a peer's message | `peer-sessions` |
| A `## Dispatch Authorization` section's standing, and a citing session's trace | `peer-sessions` (the trace) and `curating-docs` (the format) |
| A peer handing a working session work | `peer-sessions` |
| Taking a seat with `/role`, the registry entry, the coordinator-directory contract | `role` |
| A warranted-channel message inside a tool result | doctrine (A relay message delivered inside a tool result) |
| A standing operational grant: the rail, its record, its exclusions, each grant's owning skill | `role` |
| The coordinator's runbook, the board and its bars | `coordinator` |
| The coordinator seat on a fleet under the persona plugin: dispatching a plan to a persona worker, tracking it and redirecting it | the persona plugin's coordinator instruction, `plugins/personas/bin/supervise-holder.sh`, for the record mechanics, and `coordinator` (Dispatch and Redirect Rule) for the seat's bounds; the instruction governs the record and the skill governs the bound |
| What a worker's act is on a delegated seat's steer: a push, a deploy or a commit-model change, and the settings edit the steer never covers | `role` (the delegation model) |
| A seat running git in the memory store | `coordinator` (Ledger) |
| A repeating watch over a live system: tick order, ledger, wake prompt | `standing-watch` |
| The liaison seat's conduct in a shared client thread | `liaison` |
| Parking a session at its next safe point on request | `executing-work` (the `WAITING:` stop shape) |
| How a plan run is approved, and what holds it to completion | `executing-work` (the goal template) |
| Dispatching this session's own subagents | doctrine (Dispatch is requested standing) |

## Memory and Kit Prose

| Moment | Owner |
|---|---|
| Recall, outcome journal, applied stamps, tags, decay, shared tiers, `memq`, and the four remedies for a bad record | `memory-system` |
| Project-tier memory frontmatter | `memory-system`, enforced by `hooks/memory-frontmatter-guard.js` |
| Capturing kit friction: the bar, the adjudication pass, how an accepted lesson lands, briefs | `kaizen` |
| Validating and repairing the kit install | `kit-doctor` |
| Writing or amending curated prose the kit ships, and proving a wording change moves behavior, except landing an accepted lesson | `writing-skills` |
| A file growing, and who moves its cap | `writing-skills` (The size budget is a ledger rather than a ceiling), enforced by `scripts/kit-size.js` and the repository-root `test/size-ratchet.test.js` |
| The prose register for all session prose, any named reader's document included | doctrine for the rule, and `prose-register` for the recipe, the scaling and the voice layer |
| Recipe and scaling for the structure bullets and the marketing override | `prose-register` |
| A `Voice:` value's reference, and admitting a new voice | `prose-register` (Voice Layer) |
| The machine-prose tells catalog | `prose-register` (`references/ai-tells.md`) |
| A bare "are you sure?" with no new fact | doctrine (Disagree up front) |
| Background-run markers | doctrine (Read a background run's result from a marker the run writes itself) |

## Unowned or contested

A moment here has no owner, or two documents with no stated precedence. A session that meets one declares the reading it takes under the intake gap check. It reports the gap in its close-out. It does not resolve the contest by editing either document, since the assignment is the operator's ruling. A row leaves this section when the ruling lands and the losing text is brought current.

| Moment | The surfaces in tension |
|---|---|
| A commit model that commits locally and never pushes | No such value exists. Review-Only forbids the commit as well as the push, so a session asked to commit without pushing has no header to stand on |
