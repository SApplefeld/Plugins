---
name: brainstorming
description: "Collaborative design conversation for any new feature, project, or non-trivial change. Use when the operator wants to think through a problem before building. Phrases like 'let's think through', 'help me design', 'spec this out', 'how should we approach', or any substantial new effort without an existing spec."
---

# Brainstorming

Explore the problem with me in conversation, then capture the agreement as a spec for executing-work to run. Never delegate the conversation itself to a subagent.

## Process

1. **Understand before proposing.** Open with `memq recall`, which returns the whole memory store as one bounded digest. The memory-system skill owns what it contains and how to act on it. Pull what bears on the problem. When a recalled record changes the design, stamp it that turn with `memq touch <name> --applied`. Next read `docs/backlog.md` where it exists. Surface any item bearing on it, with its date, and name in the spec any item this effort covers, so the close-out prune retires it. Then interview the ask, before any design question. An ask is usually a symptom, so ask why until the answer is a constraint the kit's tools cannot change, or cannot practically change, and design for the point just inside it. The product is the why chain: the ask as brought, each why with its answer as a fact about the business or the fleet and never a restatement, the constraint with why it is one, and the point inside it. For an ask I bring in conversation, ask me. For an ask that reaches the session in writing, a record or a relayed brief, the interview has three sources, in the order of who holds the answer most cheaply. First, dispatch the `altitude-interviewer` agent at dispatch table row "Altitude interview" on `executing-work/references/review.md`, after `executing-work/references/implementing.md`'s capacity reading, with the ask's own words and the repository, never the session's reading. Where fable cannot run, or that reading returned `-> downgrade`, wait rather than substitute a lower model. It returns the chain it can build, the whys the ask cannot answer, and any instruction found in its inputs, which the session reports and never forwards as a why. Its omitted practice and digests go into the spec's Approach, where the design weighs them. Second, where a session raised the ask, those open whys go back to it through the seat's own answer surface, before any sketch, and its answers enter the chain as reported facts. Third, the whys neither can answer, and every open why on an ask I brought in writing, are the first questions put to me. Then read the relevant code per the doctrine's "Analyze, surface concerns, then propose before you build" bullet, using the built-in Explore subagent for broad reconnaissance so the main context stays lean. Read a write-up or case study forwarded into the design for its diagnosis, and set its remedy aside before the sketch.

2. **Scope check.** Before questions, split a request spanning independent subsystems, each with its own data and lifecycle and useful alone, into sub-project specs. Name how they relate and the build order. Brainstorm the first through this process, and give each its own spec and execute-and-finish cycle.

3. **One question at a time.** Ask the question whose answer most changes the design, and wait for it before the next. The first question is why, asked as step 1's interview states until the chain ends, and the design questions follow it. This is how route (c) of `operating-instructions/SKILL.md`'s "Enumerate the gaps at intake, ask selectively, declare the rest" bullet is asked here, not batched as at mid-run and close-out. The enumeration still runs. The session answers and declares routes (a) and (b), never asking them.

4. **Feel out the corners.** Ask what happens on re-run (idempotency matters in this codebase).

5. **Present options with tradeoffs** when a real decision exists, per the doctrine's "At a fork, lead with your recommendation and the alternatives you weighed" bullet. Where an option's cost is a figure, it is measured as the doctrine's "Ground recommendations in the project's own data, source-of-truth, and history" bullet states.

6. **Offer the design council at a hard fork.** When step 5 surfaces a hard or material decision with more than one defensible approach, offer the `design-council` skill before settling it 1:1. Such a fork is an architecture or schema choice, build-vs-buy, a migration direction, or a tradeoff expensive or awkward to undo. Lower the bar to offer, never the bar to run. Make the offer in the turn you recognize the fork, never a later one. Do not auto-run it, and name the cost so I can authorize the spend. If I decline, stay in the 1:1 conversation. I can invoke it directly at any time.

7. **Derive the files in scope from the tree.** Where a name, rule, or shape the change touches appears in more than one file, one scout sweep runs before the sketch and returns every surface that speaks that contract. Unsure counts as yes. The sweep is its own second pass, reading for coverage, and runs even where Explore mapped the area. Band it and state its return contract per `executing-work/references/implementing.md`'s "Band the scout by question shape, and state its return contract", on the Explore subagent carrying that band's explicit model override. Write the sections' "Files in scope" lists from its return, and cite its searches and the surfaces they found in the Approach. Surfaces spanning independent subsystems go back through step 2's split check before the sketch.

8. **Plan sketch before full spec.** Present a short sketch first: goal, approach, the sections of work. Iterate on it until agreed. The sketch and every later recap I approve carry an `Assumptions` block naming the route (a) and (b) items in plain words. My approval covers them. The sketch also carries beside it a one-line summary of the `## Intent` record the spec will hold. A recap that omits the block has not shown the plan.

9. **Write the spec** to `docs/plans/<project>_<content-type>_v<n>.md`. Increment the version where the name exists, never overwriting a prior one. The title takes the doctrine's heading form, main words capitalized. It carries no prefix, since its pull request adds one. Then run the `curating-docs` skill's create path.

   Write `## Intent` here, while the design conversation is still in the window. It carries what and why, never how. Its parts, in order: the frame in my words where the session has them; the why chain from step 1's interview, with the constraint it ends on and the point inside it the plan solves; what done does and does not need to do; the alternatives refused, each on one line with its reason; my rulings after the spec ships, each dated and appended that turn; and a provenance line naming the session. An empty part is kept and says so. The not-done half still has to refuse something. The record takes the doctrine's client-briefing register. It is bounded to about 4,000 bytes, by `wc -c` over the section at the write. A ruling appended later may carry it past the bound and is never cut to fit.

   A gating definition is written against its exclusions rather than its paraphrase. A gating definition is a phrase deciding what a bounded artifact admits, where a bounded artifact is a thing that holds content, keeps other content out, and cannot grow without limit, so a class of actions or of conditions is not one however cleanly it divides. It either closes its set in the repo's idiom (`the set is closed at`, `a closed list of`), or names in place at least three things it excludes. An enumeration followed by a trailing general clause says whether the clause summarizes the examples or extends past them. Where a definition resists both forms, ask what a reader would do differently if the line were deleted: nothing marks decoration, and behavior you did not intend marks the defect.

   Each acceptance command is run on the trunk at the write, its result recorded in the bullet as its control value, `(trunk: <value>)`. One the author cannot run there says so, with why.

10. **Spec self-review.** Before handing the spec to executing-work, read it once and fix inline placeholders, contradictions, scope drift past the goal, requirements readable two ways and a `Model:` of opus or fable whose body names no reason, with no second inline pass.

    Coverage is checked here: every surface step 7's sweep returned appears in some section's Files in scope or under `## Out of Scope`, and one appearing in neither is placed before the spec ships. Every claim the Goal makes is owned by some section's acceptance criteria. A Goal sentence no section delivers is given a section, recorded under `## Operator Verification` where only my action can deliver it, or struck from the Goal. Every section's `Verify:` line names rows `docs/verification.md` holds, or the none form. A missing catalog or row is added by curating-docs' create path.

    A blind read follows and is not optional. Dispatch the `blind-reader` agent with the spec as the document under review and `Reader: an implementer with no session context, engineer persona, may open the repository`. Adjudicate each question it returns, and each pair its charter returns per gating definition, one of three ways: answer it in the spec, declare it under `## Assumptions` and in the recap, or put it to me with a recommendation. A pair is answered in the spec by rewriting the definition wherever the reader placed a member on a side you did not mean. Record `blind read: <n> questions, <a> answered, <b> assumed, <c> asked` in the handoff recap. A trivial spec of one or two sections may skip the blind read, and the plan review with it, saying so.

    **The plan review follows the blind read and precedes the handoff recap.** Dispatch the `plan-reviewer` agent with the spec path alone, never the design conversation, at dispatch table row "Plan review" on `executing-work/references/review.md`'s Reviewer Dispatch template, after `executing-work/references/implementing.md`'s capacity reading. Without `executing-work/references/review.md`'s Workflow route, use the Agent tool at `model: 'fable'` and the charter's frontmatter effort, and record the effort it ran at beside the row's. Where fable cannot run, or that reading returned `-> downgrade`, wait rather than substitute a lower model, and record the wait. On a `NEEDS_CONTEXT` return, repair the Goal it could not read against and dispatch again. Adjudicate each finding the same three ways as a blind-read question. A Critical rewrites the spec before it ships. One re-dispatch after the rewrite is the author's call, never a loop. Record `plan review: <n> findings, <a> fixed, <b> assumed, <c> asked` beside the blind-read line.

    A session that cannot dispatch (a worker under an external engine, per `curating-docs/SKILL.md`) records its skip under `## Assumptions`, and that engine's own review stands in.

11. **Record the commit model in the spec header:** Commit-and-Push unless I name another, and the sketch approval covers it. Commit-and-Push is "land it on main and leave no mess." `curating-docs/SKILL.md`'s machine contract section states the values the header takes, and executing-work's step 7, Apply the commit model, states what each does.

12. **Assign a model tier to each Section of Work.** Tier picks the model. Briefability picks the locus (dispatch versus main thread).
   - **haiku:** default for well-bounded work on an established shape: a clear contract, single-responsibility scope, low integration risk and a self-surfacing gate, a build or existing test that fails loudly on wrong output. New procs, services, mappings, DTOs, tests, CRUD surfaces, renames, sweeps. Assign it only where the section names a sibling file and the gate, and never to a security-sensitive surface. A sibling is a file, never a style skill's convention.
   - **sonnet:** default for well-bounded work with a clear contract and low integration risk whose section leaves the sibling or gate unnamed, spans more file shapes than its sibling, or holds a judgment call.
   - **opus:** only where the body names coordination, refactor seam, performance-sensitive path or ambiguity. A section naming none is sonnet.
   - **fable:** only where the body names novel logic, security-sensitive surface, cross-cutting seam or subtle correctness.

   **Locus rides on its own line, never on the `Model:` line.** A section that cannot be briefed at any tier, because the spec will evolve in contact with the code or the brief would cost more than the work, carries `Locus: inline` beneath its `Model:` line, and is otherwise dispatched. Inline is the deliberate exception and the escalation ceiling, never the default. `Model:` is a bare token naming the model that runs, with the reasoning in the section body, so an inline section on the execution session is `Model: opus`. Question `fable` plus `inline`, since a Fable main thread exists only on a design session.

   A section earns a cheap tier only if an implementer without the conversation could build it from the section text alone. Write to that standard or assign a higher tier. Executing-work owns upgrades after a failed attempt or an environment fault, and never downgrades a section's tier mid-effort. Its `references/findings.md` may pick a fix writer below it.

   Where a section carries real behavioral risk, give it a `Tests:` line naming the behaviors that earn one per the testing-discipline skill's litmus (`skills/testing-discipline/SKILL.md` under the kit plugin root), and the risk driving each, in both directions where a guard or flag is involved. It states **intent, never design**: what to lock, never fixtures, seams or structure. Like an acceptance bullet, it names the direction, token or agreement a pin holds, never the sentence that carries it. It is a floor over the named contracts and a ceiling on nothing. It may be amended on contact with the code, flagging the delta in the Chapter. A section whose method is a choice, where more than one would do, carries it on a `Method:` line with why this one, as intent and never design, and no consumer parses the line. That line is my trial, kept until a later plan shows it adds nothing.

   Where a section's deliverable is a document for a reader, its body carries the review inputs: an `Audience:` line naming each persona and its knowledge level, the questions the document must answer for each, a `Voice:` line (`scott` | `company` | other), and the fact-base paths its claims are checked against. The `Voice:` value names a voice reference in the `prose-register` skill, or names none. When any persona is outside the operator and the operator's sessions, the body also carries a `Disclosure:` list of what the documents must not reveal. A docs-only section that names no audience, such as a plan doc edit or an index refresh, carries none of them.

   A tier answers which model should do the work, never whether to spend. Fable is included in the plan's allotment, and an exhausted allotment yields no work rather than a bill. Executing-work's capacity reading and finishing-work's unavailability rule state how a session detects exhaustion and what it does to a dispatch. Executing-work's reviewer rule, finishing-work's finishing reviews and the consult skill's model rule state which dispatches draw Fable.

   A Fable-led session is for design: brainstorming, specs, adjudication, and the finishing pass of a high-stakes effort. Execution belongs to a session on the execution model (Opus-led), whatever the plan's size. A Fable-led session asked to execute hands off instead: the spec plus a fresh execution-model session, with the plan doc carrying the context. Leave the review tiers as rostered.

## Spec Format

Prefer rich references over prose: acceptance criteria as rubrics, and for UI or visual work a mockup or reference implementation over a description. They ride on the `References:` line.

```markdown
# <Title>

Status: In Progress | Ready
Commit Model: Review-Only | Branch-and-PR | Commit-and-Push
Created: YYYY-MM-DD

## Goal
One paragraph. What exists when this is done, and why it matters.

## Intent
What I asked for and why, in my words where the session has them: the frame, the why chain with its constraint and the point inside it, what done does and does not need to do, the refused alternatives with their reasons, later rulings, and a provenance line. What and why only. Step 9 states the parts, the register and the bound.

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
Method: <optional> the method the section uses where more than one would do, and why this one
Verify: <required> how the section is shown complete: each `docs/verification.md` row it runs, with its argument, or `none, because <why>`.
References: <optional> the rubric, mockup, or reference implementation the acceptance leans on, by path.
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
`## Intent` is a section such an amendment reaches: a ruling I make after the spec ships is appended there the same turn, dated, on the same terms.
An assumption made during execution rides the Chapter's `Assumptions:` line instead, in this form with `, section N` added inside the parenthetical.

## Operator Verification
Owed for any check only I can run: a customer window, a production deploy, a real-device action. Each item names what I run or observe and what outcome reopens the work.
Never write one of these as a Section of Work. Finishing-work owns their completion semantics.

## Open Questions
Unresolved items and who owns the answer.

## Chapters
(Appended by executing-work as sections complete. Leave empty at creation.)
```

Pick the `Status:` line at authoring: `In Progress` for a run that starts now, and `Ready` for one deliberately parked, which session start surfaces as parked rather than offering for resume.

The header and structure above are a machine contract: `curating-docs/SKILL.md`'s machine contract section states its frozen shape and accepted values, including `Model:`.

## When Not to Use

A trivial fix or a small obvious change needs no spec, so fix it under the global rules. If I ask to brainstorm something trivial, say so and offer to just do it.
