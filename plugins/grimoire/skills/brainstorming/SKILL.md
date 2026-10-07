---
name: brainstorming
description: "Collaborative design conversation for any new feature, project, or non-trivial change. Use when the operator wants to think through a problem before building. Phrases like 'let's think through', 'help me design', 'spec this out', 'how should we approach', or any substantial new effort without an existing spec."
---

# Brainstorming

Explore the problem with me in conversation, then capture the agreement as a spec for the executing-work skill to run. Never delegate the conversation itself to a subagent.

## Process

1. **Understand before proposing.** Open with `memq recall`, which returns the whole memory store as one bounded digest. The memory-system skill owns what it contains and how to act on it. Read it against the problem and pull what bears on it. When a recalled record changes the design, stamp it that turn with `memq touch <name> --applied`. Next read `docs/backlog.md` where it exists. Surface any item bearing on the problem, with its date, and name in the spec any item this effort covers, so the close-out prune retires it. Then read the relevant code per the doctrine's "Analyze, surface concerns, then propose before you build" bullet, using the built-in Explore subagent for broad reconnaissance so the main context stays lean. A write-up or case study forwarded into the design is read for its diagnosis, and its remedy is set aside before the sketch.

2. **Scope check.** Before drilling into questions, split a request spanning independent subsystems, each with its own data and lifecycle and useful alone, into sub-project specs. Name how they relate and the build order, then brainstorm the first through this process, and give each its own spec and its own execute and finish cycle.

3. **One question at a time.** Ask the question whose answer most changes the design, and wait for the answer before the next. This is how route (c) of the doctrine's intake gap check is asked here, rather than in the batch its mid-run and close-out asks use. It is no license to skip the enumeration. Routes (a) and (b) are answered by the session and declared, not asked.

4. **Feel out the corners.** Ask what happens on re-run (idempotency matters in this codebase).

5. **Present options with tradeoffs** when a real decision exists, per the doctrine's "At a fork, lead with your recommendation and the alternatives you weighed" bullet.

6. **Offer the design council at a hard fork.** When step 5 surfaces a hard or material decision with more than one defensible approach, offer the `design-council` skill before settling it 1:1. Such a fork is an architecture or schema choice, build-vs-buy, a migration direction, or a tradeoff expensive or awkward to undo. Err toward offering, and lower the bar to offer, never the bar to run. Make the offer in the turn you recognize the fork, not a later one you control. Do not auto-run it, and name the cost so I can authorize the spend. If I decline, stay in the 1:1 conversation. I can invoke it directly at any time.

7. **Derive the files in scope from the tree.** Where a name, rule, or shape the change touches appears in more than one file, one scout sweep runs before the sketch and returns every surface that speaks that contract. Unsure counts as yes. The sweep is its own second pass, reading for coverage, and runs even where Explore already mapped the area. Band it and state its return contract per `executing-work/SKILL.md`'s "Band the scout by question shape, and state its return contract", on the built-in Explore subagent carrying that band's explicit model override. Write the sections' "Files in scope" lists from its return, and cite its searches and the surfaces they found in the Approach. Surfaces spanning independent subsystems go back through step 2's split check before any sketch.

8. **Plan sketch before full spec.** Present a short sketch first: goal, approach, the sections of work. Iterate on it until agreed. The sketch, and every later recap I approve, carries an `Assumptions` block naming the route (a) and route (b) items in plain words, and my approval covers them. Beside that block the sketch carries a one-line summary of the `## Intent` record the spec will hold. A recap that omits the block has not shown the plan.

9. **Write the spec** to `docs/plans/<project>_<content-type>_v<n>.md` (increment the version if the name exists; never overwrite a prior version). The spec's title is in the doctrine's heading form, with its main words capitalized, and carries no prefix. Its pull request adds the prefix. Then run the `curating-docs` skill's create path (index entry, cross-references, backlog next-steps).

   The `## Intent` section is written here, while the design conversation is still in the window. It carries what and why, never how. Its parts, in order: the frame in my words where the session has them; what done does and does not need to do; the alternatives refused, each on one line with its reason; the rulings I make after the spec ships, each dated and appended the same turn; and a provenance line naming the session. An empty part says so rather than being left out. The not-done half still has to refuse something. The record takes the doctrine's client-briefing register. It is bounded to about 4,000 bytes, read with `wc -c` over the section at the write. A ruling appended later may carry it past the bound and is never cut to fit.

   A gating definition is written against its exclusions rather than its paraphrase. A gating definition is a phrase deciding what a bounded artifact admits, where a bounded artifact is a thing that holds content, keeps other content out, and cannot grow without limit, so a class of actions or of conditions is not one however cleanly it divides. It either closes its set in the repo's idiom (`the set is closed at`, `a closed list of`), or names in place at least three things it excludes. An enumeration followed by a trailing general clause says whether the clause summarizes the examples or extends past them. Where a definition resists both forms, ask what a reader would do differently if the line were deleted: nothing marks decoration, and behavior you did not intend marks the defect.

10. **Spec self-review.** Before handing the spec to executing-work, read it once and fix inline placeholders, contradictions, scope drift past the goal and requirements readable two ways, with no second inline pass.

    Coverage is checked here: every surface step 7's sweep returned appears in some section's Files in scope or under `## Out of Scope`, and one appearing in neither is placed before the spec ships. Every claim the Goal makes is owned by some section's acceptance criteria. A Goal sentence no section delivers is given a section, recorded under `## Operator Verification` where only my action can deliver it, or struck from the Goal.

    The blind read that follows is separate and is not optional. Dispatch the `blind-reader` agent with the spec itself as the document under review and `Reader: an implementer with no session context, engineer persona, may open the repository`. Adjudicate each question it returns, and each pair its charter returns per gating definition, one of three ways: answer it in the spec, declare it under `## Assumptions` and in the recap, or put it to me with a recommendation. A pair is answered in the spec by rewriting the definition wherever the reader placed a member on a side you did not mean. Record `blind read: <n> questions, <a> answered, <b> assumed, <c> asked` in the handoff recap. A trivial spec of one or two sections may skip the blind read, saying so.

    **The plan review follows the blind read and precedes the handoff recap.** Dispatch the `plan-reviewer` agent with the spec path alone, never the design conversation, at dispatch table row "Plan review" on executing-work's Reviewer Dispatch template, after executing-work's capacity reading. Without Workflow, use the Agent tool at `model: 'fable'` and the charter's frontmatter effort, and record the effort it ran at beside the row's. Where fable cannot run at all, or that reading returned `-> downgrade`, wait rather than substitute a lower model, and record the wait. On a `NEEDS_CONTEXT` return, repair the Goal it could not read against and dispatch again. Adjudicate each finding the same three ways as a blind-read question. A Critical rewrites the spec before it ships, and one re-dispatch after that rewrite is the author's call rather than a loop. Record `plan review: <n> findings, <a> fixed, <b> assumed, <c> asked` beside the blind-read line.

    A spec that skipped the blind read skips the plan review with it, and says so. A session that cannot dispatch (a worker under an external engine) records the skip under `## Assumptions`, and that engine's own review stands in.

11. **Record the commit model in the spec header:** Commit-and-Push unless I name another, and the sketch approval covers it. Commit-and-Push is "land it on main and leave no mess." `curating-docs/SKILL.md`'s machine contract section states the values the header takes, and executing-work's step 7, Apply the commit model, states what each does.

12. **Assign a model tier to each Section of Work.** Tier picks the model. Briefability picks the locus (dispatch versus main thread).
   - **haiku:** pure transcription: an exact sibling to clone with substitutions, single-responsibility scope, and a self-surfacing gate, a build or existing test that fails loudly on wrong output. Renames and sweeps, config or DTO additions mirroring a named sibling, test data, pin-test count updates. Assign it only where the section text names both the sibling and the gate. A section that leaves either to be found, or holds any judgment call, is `sonnet`.
   - **sonnet:** mechanical or well-bounded: a clear contract, an existing sibling pattern, single-responsibility scope, low integration risk. New procs or services on an established shape, mappings, DTOs, tests, CRUD surfaces.
   - **opus:** moderate complexity: multi-file coordination, nuanced refactors, performance-sensitive logic, mild ambiguity within a clear design.
   - **fable:** the strongest model: novel logic, security-sensitive surfaces, cross-cutting architecture, subtle correctness. Dispatches to `implementer-fable`, which inherits the session model or takes an explicit `fable` override from a below-fable session.

   **Locus rides on its own line, never on the `Model:` line.** A section that cannot be briefed at any tier, because the spec will evolve in contact with the code or the brief would cost more than the work, carries `Locus: inline` beneath its `Model:` line, and is otherwise dispatched. Inline is the deliberate exception and the escalation ceiling, never the comfortable default. `Model:` is a bare token naming the model that will actually run, with the reasoning in the section body, so an inline section on the execution session is `Model: opus`. Question `fable` plus `inline`, since a Fable main thread exists only on a design session.

   A section earns a cheap tier only if an implementer with no conversation context could build it from the section text alone. Write to that standard or assign a higher tier. Tiers are planning-time recommendations. Executing-work may upgrade one after a failed attempt or an environment fault, and owns which, but never downgrades one mid-effort.

   Where a section carries real behavioral risk, give it a `Tests:` line naming the behaviors that earn one per the testing-discipline skill's litmus (`skills/testing-discipline/SKILL.md` under the kit plugin root), and the risk driving each, in both directions where a guard or flag is involved. It states **intent, never design**: what to lock, never fixtures, seams or structure. Like an acceptance bullet, it names the direction, token or agreement a pin holds, never the sentence that carries it. It is a floor over the named contracts and a ceiling on nothing, and it is amendable on contact with the code, with the delta flagged in the Chapter.

   Where a section's deliverable is a document for a reader, its body carries the review inputs: an `Audience:` line naming each persona and its knowledge level, the questions the document must answer for each, a `Voice:` line (`scott` | `company` | other), and the fact-base paths its claims are checked against. The `Voice:` value names a voice reference in the `prose-register` skill, or names none. When any persona is outside the operator and the operator's own sessions, the body also carries a `Disclosure:` list of what the documents must not reveal. A docs-only section that names no audience, such as a plan doc edit or an index refresh, carries none of them.

   A tier answers which model should do the work, never whether to spend. Fable is included in the plan's allotment, and an exhausted allotment yields no work rather than a bill. Executing-work's capacity reading and finishing-work's unavailability rule state how a session detects exhaustion and what it does to a dispatch. Executing-work's reviewer rule, finishing-work's finishing reviews and the consult skill's model rule state which dispatches draw Fable.

   A Fable-led session is for design: brainstorming, specs, adjudication, and the finishing pass of a high-stakes effort. Execution belongs to a session on the execution model (Opus-led today), whatever the plan's size. When a Fable-led session is asked to execute, the move is a handoff, not a favor: the spec plus a fresh execution-model session, with the plan doc carrying the context. Leave the review tiers as rostered.

## Spec Format

Prefer rich references over prose: acceptance criteria as runnable checks or rubrics, and for UI or visual work a mockup or reference implementation over a description. They ride on the `References:` line.

```markdown
# <Title>

Status: In Progress | Ready
Commit Model: Review-Only | Branch-and-PR | Commit-and-Push
Created: YYYY-MM-DD

## Goal
One paragraph. What exists when this is done, and why it matters.

## Intent
What I asked for and why, in my words where the session has them: the frame, what done does and does not need to do, the refused alternatives with their reasons, later rulings, and a provenance line. What and why only. Step 9 states the parts, the register and the bound.

## Approach
The agreed design, with key decisions and their reasoning, so a later or compacted session understands intent, not just steps.
Where step 7's sweep ran, its result: the searches run and the surfaces they found.

## Sections of Work
### 1. <Section name>
Model: haiku | sonnet | opus | fable
Locus: <omit to dispatch> | inline
What gets built. Acceptance criteria as verifiable statements.
Files in scope: <derived from the Approach's sweep where one ran>.
Tests: <optional> the behaviors this section must lock and the risk driving each.
References: <optional> the runnable check, rubric, mockup, or reference implementation the acceptance leans on, by path.
Audience: <deliverable documents only> each persona and its knowledge level, with the other review inputs step 12 names in the body.
### 2. ...

## Out of Scope
Explicitly excluded items, so drift is detectable.

## Assumptions
One bullet per assumption the session proceeded on, in this exact form:
`- assumed YYYY-MM-DD (<route: a source name | default>): <the assumption>; reversal: <what changing it costs>`.

An assumption is shown to me in the recap first and recorded here after, never the reverse.
This section freezes at approval, because everything above `## Chapters` falls inside the external engine's approval-scoped fingerprint.
The freeze bars the routine per-section append, never a deliberate spec amendment above that line when the design changes, which a Chapter records as drift.
`## Intent` is a section such an amendment reaches: a ruling I make after the spec ships is appended there the same turn, dated, on the same terms, recorded in the Chapter as drift.
An assumption made during execution rides the Chapter's `Assumptions:` line instead, in this form with `, section N` added inside the parenthetical.

## Operator Verification
(Optional.) Checks only I can run: a customer window, a production deploy, a real-device action. Each item names what I run or observe and what outcome reopens the work.
Never write one of these as a Section of Work. Finishing-work owns their completion semantics.

## Open Questions
Unresolved items and who owns the answer.

## Chapters
(Appended by executing-work as sections complete. Leave empty at creation.)
```

The `Status:` line is picked at authoring. A spec for a run that starts now is born `In Progress`, and one deliberately parked is born `Ready`, which session start surfaces as parked rather than offering for resume.

The header and structure above are a machine contract: `curating-docs/SKILL.md`'s machine contract section states its frozen shape and the values it accepts, including `Model:`.

## When Not to Use

A trivial fix or a small obvious change needs no spec. Just fix it under the global rules. If I ask to brainstorm something that turns out to be trivial, say so and offer to just do it.
