# Reviewing a Section

Part of the executing-work skill: step 3 of the section loop, with the dispatch table and the Reviewer Dispatch template.

3. **Review.** On round 1, dispatch the `adversarial-reviewer` agent and the `blind-reviewer` agent in parallel with each other, overlapping no run of yours. Step 2's targeted run has finished before this step opens, and under Branch-and-PR its first-green commit has already landed at step 7. Their fixes land in step 4, which runs the section's close gate after them, so the gate that closes the section covers what the round changed (the lanes and their moments are owned by the operating doctrine's gate bullet). The adversarial-reviewer gets the spec path, the base git ref or changed-file list, the section name, and a REQUIRED `Amendments in effect:` line filled from the plan doc's `Standing Brief Amendments` block or explicitly `none`. When the section touched C# or T-SQL, it also gets the csharp-style or sql-style absolute paths, resolved by the Dispatch Brief template's style-skill ladder.

   Every sentence of the blind-reviewer's brief passes one test: would it read identically for every diff in this repository? So it gets the base git ref or changed-file list, never a captured diff. It never gets the spec path, the plan, the section name, or a line on what the change adds or where to focus. Omit docs/ paths from the changed-file list, since their hunks carry the intent story. The withheld items are the common leaks, not the rule. A brief that withholds every one of them and still says what the section was for has failed the test. The blind boilerplate carries one line telling the reviewer not to read under `.kit/`, since that scratch path sits inside the tree it greps.

   **A section carrying an `Audience:` line is a deliverable document, and the document pair is added to whatever the section's own content earns, never subtracted from it.** It replaces the code pair only where the section's changed files are all documents. Dispatch `blind-reader` once per persona the `Audience:` line names, carrying the document paths and its `Reader:` line only, under the same property test. Dispatch `prose-reviewer` once with the full Document Review Brief (template below). Where the section also changed code, the code pair reviews its non-document files in the same round.

   Where omitting the docs/ paths empties the list on a section with no `Audience:` line, skip the blind dispatch, run the adversarial-reviewer alone, and record `blind: no code diff` on the Chapter's review line. If the section touched input handling, authentication or authorization, SQL construction, secrets or configuration, shell or process execution, a command permission grant it composes or widens, a hook that emits an allow or deny decision, or an external boundary, also dispatch the `security-reviewer` agent alongside them. If the section's delta spawns a process, runs on a per-tool-call path, walks the tree, holds a lock, waits on another process, or queries a store, also dispatch the `performance-reviewer` agent alongside them.

   **The four code lenses run in two tiers, ranked adversarial, blind, performance, security.** The correctness tier, the adversarial-reviewer and the blind-reviewer, drives step 4's fix round, provenance read, design stop and round backstop. The advisory tier, the performance-reviewer and the security-reviewer, takes step 4's advisory disposition for its Criticals and Majors. Tier is keyed on the lens and never on the finding. Both advisory lenses ride round 1 and a re-raised round where their triggers above hold, and join no decayed round.

   **The `Amendments in effect:` line is sighted-only.** Every sighted dispatch in the round carries it, the prose-reviewer's as a Document Review Brief field, save the scope adjudicator's. It never reaches the blind-reviewer or the blind-reader.

   **The adversarial lens, the security lens, the performance lens and the scope adjudicator carry a `Trace target:` line, and no other dispatch does.** The line names the spec's Goal, its `## Intent` record where the plan carries one, and its acceptance bullets as amended by any `Standing Brief Amendments` entry. Quote any bullet an amendment moved into the dispatch, since a by-path read returns the unamended bullets. The adjudicator's relevance brief carries only the Goal, the `## Intent` record and the acceptance bullet a performance finding quotes.

   **No run of this session's is in flight during the round, so any contention left is somebody else's.** Where this repo has exactly one shared resource a reviewer's build or run would block on, and anything holds it, a sibling session's suite or build among them, carry the Dispatch Brief's workspace-constraint line into every reviewer brief. It names the process holding the resource and the operations it puts off-limits.

   **A section's first review round runs every reviewer one tier up from the section's writer tier, Fable the ceiling.** Round 1 is the full roster: the code pair, the document pair, or both where the Audience rule above summons both, plus each advisory lens whose trigger holds. Every later round is one dispatch at the writer's tier, carrying what its round 1 brief carried: the prose-reviewer where the fix delta touched only deliverable documents the Audience rule names, else the adversarial-reviewer.

   A Critical from a correctness lens that survives adjudication, in any round, re-raises the next round to round 1's roster, rows and tier, the tier re-read against the writer tier in force when it dispatches. A re-raised round that returns no such Critical hands the next round back to one lens. After a tier escalation the escalated tier is the writer tier. A later round over a haiku writer runs at sonnet, the reviewer floor.

   An inline section's writer tier is the session's model, which built it, and an untiered section takes whatever tier built it. The reviewer's tier rides as an explicit model override on every dispatch, and a `fable` override takes step 1's capacity reading first. The one inheriting case is a Fable reviewer on a Fable-led session, which passes no override and takes no reading. A first-aim gate that could not be run at its fable tier here is confirmed per finishing-work's unavailability rule or measured by step 1's capacity reading, compensated per dispatch table row "Gate compensation", and recorded. A per-section reviewer below Fable whose tier could not run, confirmed the same way, re-aims one tier up, Fable the ceiling, one dispatch at a time with the ladder's one retry. A chain whose re-aim at fable is itself ruled out ends that dispatch's gate ungated. A re-aim, an ungated end and the document pair with its readers count go on the Chapter's review line in the template's form. A re-aim or an ungated end is neither pass nor failure for step 1's escalation ladder.

   **Never pre-judge the review:** do not tell a reviewer what to flag, what to ignore, or how to rate a finding ("treat as Minor", "the plan chose this"). Let each reviewer surface it and adjudicate per responding-to-review. **A repo-wide defect class is neither pre-judging nor contamination.** The test is the blind-reviewer's own: would the sentence read identically for every diff in this repository? A standing property passes and may ride in any dispatch, the blind one included. A sentence that would change with the section is barred from the blind dispatch, and barred everywhere as pre-judging when it carries a rating.

   **Bracket every round with a tree-state capture.** Run `git status --porcelain` before you dispatch and again when the round returns, and compare the two before acting on a single finding. Two deltas are no incident. One is in a concurrent section's declared files while a live dispatch for that section covers them, checked against the live dispatches the interim board entry records with what each was asked, where one has been written. The other is a write this session made under steps 4 through 8 or the interim-board ritual, its authorship established by reading the delta's content, never by its path. Any other delta is an incident: restore the tree, record the delta and the agent that produced it in the Chapter, treat that agent's findings as suspect pending a re-review against the restored tree, and jot a kaizen note.

   For a genuinely trivial, self-contained section (a rename, a comment, a one-line change with no logic), the per-section reviews are optional as a pair, since finishing-work still covers it.

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

   **The dispatch table.** The model rule above sets each reviewer's model, and this table sets the effort and route of every dispatch the kit makes. Read a dispatch's effort and route off its row. Other skills point at a row by its bold short name.

   | The dispatch | Model | Effort | Route |
   |---|---|---|---|
   | **Round 1 pair** over an opus or fable writer: `adversarial-reviewer`, `blind-reviewer`, `blind-reader`, `prose-reviewer` | fable | `low` (frontmatter default) | Agent tool |
   | **Round 1 security** over an opus or fable writer, `security-reviewer` | fable | `medium` (frontmatter default) | Agent tool |
   | **Round 1 performance** over an opus or fable writer, `performance-reviewer` | fable | `medium` (frontmatter default) | Agent tool |
   | **Scope adjudicator**, in every shape step 4 and finishing-work dispatch it, `scope-adjudicator` | fable | `high` (frontmatter default) | Agent tool |
   | **Below-fable round 1**: reviewers one tier above a haiku- or sonnet-tier writer, whichever lens | sonnet or opus | `medium` | `Workflow` |
   | **Fable later round**: one lens over a fable writer, `adversarial-reviewer` or `prose-reviewer` | fable | `low` (frontmatter default) | Agent tool |
   | **Below-fable later round**: one lens over a haiku, sonnet or opus writer | the writer's tier, sonnet the floor | `medium` | `Workflow` |
   | **Below-fable re-aim**: a per-section reviewer re-aimed after its tier was ruled out, landing below fable | one tier up | `medium` | `Workflow` |
   | **Fable re-aim**: the same, landing on fable | fable | `medium` | `Workflow` |
   | **Finishing reviews** over the whole changeset | fable | `medium` | `Workflow`, per finishing-work |
   | **Gate compensation** for a Fable gate ruled out | opus | `high` | `Workflow`, per finishing-work |
   | **Haiku implementer**, `implementer-haiku` | haiku | `medium` (frontmatter default) | Agent tool |
   | **Sonnet implementer**, `implementer-sonnet` | sonnet | `medium` (frontmatter default) | Agent tool |
   | **Opus implementer**, `implementer-opus` | opus | `medium` (frontmatter default) | Agent tool |
   | **Fable implementer**, `implementer-fable` | fable | `medium` (frontmatter default) | Agent tool |
   | **Fable consultant**, `consultant` | fable | `high` (frontmatter default) | Agent tool |
   | **Consultant stand-in** where fable cannot run | opus | `high` | `Workflow` |
   | **Plan review**, `plan-reviewer` | fable | `medium` | `Workflow` |
   | **Spec blind read**, `blind-reader` | the session's | `low` (frontmatter default) | Agent tool |
   | **Other below-fable dispatch** without a frontmatter effort | opus or sonnet | `medium` | `Workflow` where used |
   | **Other fable dispatch**, the same at fable | fable | `medium` | `Workflow` where used |

   An agent no row names runs at its frontmatter effort, or with none set, on the route its own skill gives it. The scope adjudicator's row is its charter's own pin, and the below-fable rows are the rule's own levels, neither compensation.

   **Dispatching on the Workflow route.** On v2.1.205 the Agent tool takes a model override but has no effort parameter. So any dispatch whose row names `Workflow` as its route goes through `Workflow`'s `agent()`. Every such call fills this template:

   ```
   Reviewer Dispatch (all REQUIRED):
   - agentType: the agent's scoped name (grimoire:adversarial-reviewer,
     grimoire:blind-reviewer, grimoire:blind-reader, grimoire:prose-reviewer,
     grimoire:security-reviewer, grimoire:performance-reviewer,
     grimoire:consultant, grimoire:plan-reviewer, grimoire:scope-adjudicator).
     Omitting it yields a workflow-subagent, a type readonly-agent-guard does not
     govern, which hands the tree under review to an agent free to rewrite it
   - model: named explicitly, never left to inherit. A call carrying an effort but no
     model runs the session's model at that effort, which on a below-fable session is
     a weak model at maximum effort: the downgrade this rule exists to prevent
   - effort: named explicitly, never left to inherit. An unnamed effort resolves
     to no dependable default
   ```

   A dispatch on this route carries the `Amendments in effect:` and `Trace target:` lines the rules above give it, beside the template rather than in it.

   The doctrine's standing-dispatch bullet carries the operator's request for this route, so it needs no per-session ask. The round stays one round: mixed Agent-tool and Workflow dispatches go out together under the single tree-state capture, and a Workflow round is awaited by the `WAITING:` turn end like any dispatch. Every input contract above still binds on this route. A script assembling several dispatches authors each blind prompt as its own literal, the blind boilerplate plus its contract inputs and nothing else, sharing no brief-building constant, helper, or template variable with any sighted dispatch. The property test judges the assembled string each agent will actually receive, never the ingredient list.

   Where the Workflow route is unavailable in a session, the dispatch and any re-aim of it take the Agent tool at the row's own model override and the agent's frontmatter effort. The Chapter records the effort the review ran at beside its row's effort.

   **Compensation belongs to gate-shaped work and never to plan-following work.** It reaches the consultant and the scope adjudicator, gates with no backstop, and never an implementer.

