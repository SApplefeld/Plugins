# Reviewing a Section

Part of the executing-work skill: step 3 of the section loop, with the dispatch table and the Reviewer Dispatch template.

3. **Review.** On round 1, dispatch the `adversarial-reviewer` and `blind-reviewer` in parallel, overlapping no run of yours. Step 2's targeted run has finished, and under Branch-and-PR its first-green commit has landed at step 7. Their fixes land in step 4, which runs the section's close gate after them, so the gate that closes the section covers what the round changed (the lanes and their moments are owned by the operating doctrine's gate bullet). The adversarial-reviewer gets the spec path, the base git ref or changed-file list, the section name, and a REQUIRED `Amendments in effect:` line from the plan doc's `Standing Brief Amendments` block or explicitly `none`. A C# or T-SQL section adds the csharp-style or sql-style absolute paths, resolved by the Dispatch Brief template's style-skill ladder.

   Every sentence of the blind-reviewer's brief passes one test: would it read identically for every diff in this repository? So it gets the base git ref or changed-file list, never a captured diff. It never gets the spec path, the plan, the section name, or a line on what the change adds or where to focus. Omit docs/ paths from the list, since their hunks carry the intent story. These are the common leaks, not the rule. A brief withholding them all still fails if it says what the section was for. Where omitting them empties the list on a section with no `Audience:` line, skip the blind dispatch, run the adversarial-reviewer alone, and record `blind: no code diff` on the Chapter's review line. The blind boilerplate bars reading under `.kit/`, a scratch path inside the tree it greps.

   **A section carrying an `Audience:` line is a deliverable document, and the document pair joins whatever the section's own content earns.** It replaces the code pair only where every changed file is a document. Dispatch `blind-reader` once per persona the `Audience:` line names, carrying only the document paths and its `Reader:` line, under the same property test. Dispatch `prose-reviewer` once with the full Document Review Brief below. Where the section also changed code, the code pair reviews its non-document files in the same round.

   If the section touched input handling, authentication or authorization, SQL construction, secrets or configuration, shell or process execution, a command permission grant it composes or widens, a hook emitting an allow or deny decision, or an external boundary, also dispatch `security-reviewer`. If the section's delta spawns a process, runs on a per-tool-call path, walks the tree, holds a lock, waits on another process, or queries a store, also dispatch `performance-reviewer`.

   **The four code lenses run in two tiers, ranked adversarial, blind, performance, security.** The correctness tier, adversarial and blind, drives step 4's fix round, provenance read, design stop and round backstop. The advisory tier, performance and security, takes step 4's advisory disposition for its Criticals and Majors. Tier keys on the lens, never the finding. The advisory lenses ride round 1 and re-raised rounds where their triggers hold, never a decayed round.

   **The `Amendments in effect:` line is sighted-only.** Every sighted dispatch in the round carries it, the prose-reviewer's as a Document Review Brief field, save the scope adjudicator's. It never reaches the blind-reviewer or blind-reader. The `Fix delta:`, `Adjudicated findings:` and `Step back:` lines ride the adversarial dispatch alone, a re-raised round's included.

   **The adversarial, security and performance lenses and the scope adjudicator carry a `Trace target:` line, and no other dispatch does.** It names the spec's Goal, its `## Intent` record where one exists, and its acceptance bullets as amended by any `Standing Brief Amendments` entry. Quote into the dispatch any bullet an amendment moved, since a by-path read returns it unamended. The adjudicator's relevance brief carries only the Goal, the `## Intent` record and the acceptance bullet a performance finding quotes.

   **The adversarial, security and performance lenses carry a `Failure by area:` line, and no other dispatch does.** It quotes the header and each row of the repository's `docs/verification.md` Failure by Area table whose Area holds a changed file, a file under a Skip path included, or reads `none written` where no such row exists. It closes with `Skip names context you need not read, never a changed file to pass over.` The blind-reviewer, blind-reader and scope adjudicator never carry it.

   **No run of this session's overlaps the round, so any contention is somebody else's.** Where exactly one shared resource in this repo would block a reviewer's build or run, and anything holds it, a sibling session's suite or build included, carry the Dispatch Brief's workspace-constraint line into every reviewer brief.

   **A section's first review round runs every reviewer one tier up from the section's writer tier, capped at its lens's ceiling.** The ceiling is Opus for the blind, security and performance reviewers, the scope adjudicator and the finding verifier, and Fable for every other lens. Round 1 is the full roster: the code pair, the document pair, or both where the Audience rule above summons both, plus each advisory lens whose trigger holds. Every later round is one dispatch at the writer tier: the prose-reviewer, carrying its round 1 brief, where the fix delta touched only deliverable documents, else the adversarial-reviewer. The adversarial dispatch's round 1 brief gains `Fix delta:`, the files the fix round changed, from the fix writer's report or the orchestrator's edits. `Adjudicated findings:` lists each Critical and Major this section's earlier rounds returned, as the lens printed it, with its disposition from a closed set: fixed, justified-not-fixed, refused, refuted, declared, Minor-listed, held, deferred, routed-out. `refuted` entries carry the verifier's ground. From the fourth round a `Step back:` line names the rounds run and asks first whether the remaining findings share a cause in the approach, and that round reads the whole changeset.

   A correctness lens's Critical that survives adjudication unrefuted, in any round, re-raises the next round to round 1's roster, rows and tier, read against the writer tier in force when it dispatches. A re-raised round returning no such Critical hands the next round back to one lens.

   The writer tier is the session's model for an inline section, the tier that built an untiered one, the escalated tier after a tier escalation, and a dispatched fix writer's over its delta. The reviewer's tier rides as an explicit model override on every dispatch, save a Fable reviewer on a Fable-led session. A first-aim gate that could not be run at its fable tier is confirmed per finishing-work's unavailability rule or measured by step 1's capacity reading, compensated per dispatch table row "Gate compensation", and recorded. A gate aimed at its Opus ceiling that could not run there, confirmed per the unavailability rule, ends ungated with no lower compensation, recorded as finishing-work records an ungated end. A per-section reviewer below its lens's ceiling whose tier could not run, confirmed the same way, re-aims one tier up, one dispatch at a time with the ladder's one retry. A chain whose re-aim at that ceiling is itself ruled out ends that dispatch's gate ungated. A re-aim or an ungated end is neither pass nor failure for step 1's escalation ladder.

   **Never pre-judge the review:** do not tell a reviewer what to flag, what to ignore, or how to rate a finding ("treat as Minor", "the plan chose this"). Let each reviewer surface it and adjudicate per responding-to-review. **A repo-wide defect class is neither pre-judging nor contamination.** A standing property passes the blind-reviewer's test above and rides anywhere. A sentence that changes with the section is barred from the blind dispatch, and from all when it carries a rating. An `Adjudicated findings:` line is exempt, since it rates nothing new.

   **Bracket every round with a tree-state capture.** Run `git status --porcelain` before dispatch and on return, and compare them before acting on any finding. Two deltas are no incident. One is in a concurrent section's declared files while a live dispatch for that section covers them, checked against the live dispatches and what each was asked, as the interim board entry records them where one exists. The other is this session's own write under steps 4 through 8 or the interim-board ritual, its authorship read from the delta's content, never its path. Any other delta is an incident: restore the tree, record the delta and its agent in the Chapter, treat that agent's findings as suspect until re-reviewed against the restored tree, and jot a kaizen note.

   The per-section review pair is optional for a trivial, self-contained section, such as a rename, a comment or a one-line change with no logic, since finishing-work still covers it.

   **The Document Review Brief.** The document pair's dispatches fill this template. Add no field to the blind-reader's dispatch beyond what its input contract names.

   ```
   Document Review Brief:
   - blind-reader (one dispatch per persona the Audience: line names):
     - Document paths
     - Reader: the persona and its knowledge level
     - Nothing else that describes the documents' intent (a standing repo
       property may ride; anything that would change with the section may not)
   - prose-reviewer (one dispatch):
     - Spec path + document paths in scope
     - Amendments in effect: every entry from the plan doc's Standing Brief
       Amendments block, or explicitly "none"
     - Audience: each persona and its knowledge level, from the section
     - Voice: scott | company | other, naming a voice reference in the
       prose-register skill or naming none
     - Fact-base paths: the code, living docs, and the canonical numbers
       table where one exists
     - The prose-register skill's absolute path plus its
       references/ai-tells.md, resolved by the same ladder as the Dispatch
       Brief's style-skill bullet
     - The voice reference's absolute path where the Voice: value names
       one, resolved by the same ladder
   ```

   **The dispatch table.** The model rule above sets each reviewer's model. Each kit dispatch takes its effort and route from its row. Other skills point at a row by its bold short name.

   | The dispatch | Model | Effort | Route |
   |---|---|---|---|
   | **Round 1 pair** over an opus or fable writer: `adversarial-reviewer`, `blind-reader`, `prose-reviewer` | fable | `low` (frontmatter default) | Agent tool |
   | **Round 1 blind** over an opus or fable writer, `blind-reviewer` | opus | `low` (frontmatter default) | Agent tool |
   | **Round 1 security** over an opus or fable writer, `security-reviewer` | opus | `medium` (frontmatter default) | Agent tool |
   | **Round 1 performance** over an opus or fable writer, `performance-reviewer` | opus | `medium` (frontmatter default) | Agent tool |
   | **Scope adjudicator**, in every shape step 4 and finishing-work dispatch it, `scope-adjudicator` | opus | `high` (frontmatter default) | Agent tool |
   | **Finding verifier**, in every shape step 4 and finishing-work dispatch it, `finding-verifier` | opus | `high` (frontmatter default) | Agent tool |
   | **Below-fable round 1**: reviewers one tier above a haiku- or sonnet-tier writer, whichever lens | sonnet or opus | `medium` | `Workflow` |
   | **Fable later round**: one lens over a fable writer, `adversarial-reviewer` or `prose-reviewer` | fable | `low` (frontmatter default) | Agent tool |
   | **Below-fable later round**: one lens over a haiku, sonnet or opus writer | the writer's tier, sonnet the floor | `medium` | `Workflow` |
   | **Below-fable re-aim**: a per-section reviewer re-aimed after its tier was ruled out, landing below fable | one tier up | `medium` | `Workflow` |
   | **Fable re-aim**: the same, landing on fable | fable | `medium` | `Workflow` |
   | **Finishing reviews**: the document lenses, and the final adversarial review where any section is uncleared | fable | `medium` | `Workflow`, per finishing-work |
   | **Finishing adversarial, cleared**: the final adversarial review where every section is cleared, per finishing-work | opus | `medium` | `Workflow`, per finishing-work |
   | **Finishing advisory**: the security and performance lenses over the whole changeset | opus | `medium` | `Workflow`, per finishing-work |
   | **Gate compensation** for a Fable gate ruled out | opus | `high` | `Workflow`, per finishing-work |
   | **Haiku implementer**, `implementer-haiku` | haiku | `medium` (frontmatter default) | Agent tool |
   | **Sonnet implementer**, `implementer-sonnet` | sonnet | `medium` (frontmatter default) | Agent tool |
   | **Opus implementer**, `implementer-opus` | opus | `medium` (frontmatter default) | Agent tool |
   | **Fable implementer**, `implementer-fable` | fable | `medium` (frontmatter default) | Agent tool |
   | **Fable consultant**, `consultant` | fable | `high` (frontmatter default) | Agent tool |
   | **Consultant stand-in** where fable cannot run | opus | `high` | `Workflow` |
   | **Plan review**, `plan-reviewer` | fable | `medium` | `Workflow` |
   | **Spec blind read**, `blind-reader` | the session's | `low` (frontmatter default) | Agent tool |
   | **Altitude interview**, `altitude-interviewer` | fable | `low` (frontmatter default) | Agent tool |
   | **Other below-fable dispatch** without a frontmatter effort | opus or sonnet | `medium` | `Workflow` where used |
   | **Other fable dispatch**, the same at fable | fable | `medium` | `Workflow` where used |

   An agent no row names runs at its frontmatter effort, if any, on its skill's route.

   **Dispatching on the Workflow route.** On v2.1.205 the Agent tool takes a model override but has no effort parameter. So a dispatch routed to `Workflow` goes through `Workflow`'s `agent()`. Every such call fills this template:

   ```
   Reviewer Dispatch (all REQUIRED):
   - agentType: `grimoire:<seat>` for a seat `STRICT_SEAT` in the kit source's
     `plugins/personas/hooks/guards/agent-class.ts` names.
     Omitting it yields a workflow-subagent, a type `readonly-agent` does not
     govern, which hands the tree under review to an agent free to rewrite it
   - model: named explicitly, never left to inherit. A call carrying an effort but no
     model runs the session's model at that effort, on a below-fable session a weak
     model at maximum effort
   - effort: named explicitly, never left to inherit. An unnamed effort resolves
     to no dependable default
   ```

   A dispatch on this route carries the `Amendments in effect:`, `Trace target:` and `Failure by area:` lines the rules above give it, beside the template, not in it.

   The doctrine's standing-dispatch bullet carries the operator's request for this route, so it needs no per-session ask. The round stays one round: mixed Agent-tool and Workflow dispatches go out together under the single tree-state capture and are awaited by the `WAITING:` turn end like any dispatch. Every input contract above still binds on this route. A script assembling several dispatches authors each blind prompt as its own literal, the blind boilerplate plus its contract inputs and nothing else, sharing no brief-building constant, helper, or template variable with any sighted dispatch. The property test judges the assembled string each agent receives, never the ingredient list.

   Where Workflow is unavailable, the dispatch and any re-aim take the Agent tool at the row's model override and the agent's frontmatter effort. The Chapter records the actual effort beside the row's.

   **Compensation belongs to gate-shaped work and never to plan-following work.** It reaches a Fable-aimed gate, the consultant among them, and never an implementer.
