# Implementing a Section

Part of the executing-work skill: steps 1 and 2 of the section loop, and the rules for delegating to subagents.

1. **Confirm the approach, then implement.** Where the spec assumed a section's mechanism without reading the code, confirm the approach holds in a lightweight read of the files it touches, never a fan-out. A file opened to find one mechanism takes the doctrine's rule on hunting in a large file, usually over more than one range. Where the real shape differs materially, adjust and note it in the Chapter. Raise it to me only if design intent changes. Then implement per the tier: a section carrying a `Model:` tier goes to that tier's implementer. The doctrine's standing dispatch request covers this, even under a session-prompt line conditioning dispatch on my request.

   **At each section open, grep the plan doc for its `Standing Brief Amendments` block and hold every entry as binding.** Step 4 writes to the block mid-run, so an earlier read is stale. A grep that finds nothing is still the read. On the dispatch path the entries ride into the brief, and an inline section has only the grep. The same open writes the whole section's add-decision line, its file and five parts set by step 4 in `references/findings.md`. This line fires no stop. An inline section's open also writes the brief's start-of-work statement beside that line.

   **The same open writes the section's promises file, `.kit/scratch/<plan-slug>/promises-section-<n>.json`.** It holds one `{ id, promise }` entry per acceptance bullet and per sentence naming a behavior the section builds. A dispatched implementer runs it through the brief's `Promise check:` field.

   - **A section that writes under `docs/` goes to the main thread whatever its tier.** An implementer may return drafted prose in its final message, but the main thread writes it. Record `Locus: inline` under the `Model:` line, which keeps the bare tier the section earned.
   - **Tier `sonnet` / `opus` / `fable`:** dispatch the matching `implementer-<tier>` agent with a brief built from the Dispatch Brief template. A `Model: haiku` line, or a `Model: sonnet` line whose body cites no case on brainstorming step 12's list, is read as `opus`. Amend it to `opus` on the plan's own branch at the section open, record the drift in the Chapter, and dispatch `implementer-opus`.

     ```
     Dispatch Brief (all REQUIRED unless marked):
     - Spec path + section name
     - Files in scope
     - Acceptance criteria (verifiable)
     - Rich references: the section's References: line when the spec has one,
       plus any mockup, rubric, or reference implementation its acceptance
       leans on, by path. Verify: the section's Verify: line verbatim, each
       row it names quoted with its command and pass shape. Open your report
       with the start-of-work statement, how the finished work will be shown
       complete, read from the Goal, the Intent and the section, a test or a
       screenshot among the forms, and close with its result
     - Tests: the section's Tests: line verbatim when the spec has one, a floor
       over the named contracts and a ceiling at its allocation, a candidate
       past it a request to the orchestrator and never a test written first,
       and amendable on contact with the code where a named contract proves to
       be a choice, with the amendment flagged in your report; else the
       test-worthiness call per the testing-discipline skill's Triage, its
       absolute path resolved by the same ladder as the Style-skill file paths
       bullet below, and what a test should lock
     - Sibling pattern to mirror, when one exists: name it AND require mirrored
       failure-mode breadth (catch scope, regex generality)
     - Error and delete semantics to preserve (throw vs truncate, hard vs soft
       delete, explicit NULL vs column default)
     - The standing hostile-boundary reuse step: before writing a call at a
       hostile boundary, grep the tree for its other callers and reuse a
       correct one's guard rather than matching its protections by hand. One
       grep, and no new capability. A spawned process, a child environment,
       text bound for a trusted channel and a clamped bound are instances and
       not the boundary: the class is any call whose safety rests on what the
       far side is protected against. Where the guard's file sits in Files in
       scope, export the guard and call it. Where it does not, name that file,
       the guard, and the export it needs in the report and leave it unedited,
       for step 4's out-of-scope route. The guard at a boundary is a property
       of the channel rather than of the caller that first needed it, so a
       hand-written second caller drops the protections it cannot see and
       fails only on the input the guard was there for
     - Pin tests + new expected values, when the section changes a counted
       cross-cutting set
     - Standing Brief Amendments: every entry from the plan doc's block, when one exists
     - The standing working-class directive, in every brief, naming a
       subfolder unique to this dispatch,
       `.kit/scratch/<plan-slug>/<agent-label>/`. It ends no process it did
       not start, never one by image name. It performs no git operation reaching
       past its own files, a stash, discarding reset, checkout or restore,
       clean, branch delete and worktree remove among them, and no
       `git checkout -- <file>`, which restores to HEAD. It deletes or
       overwrites no other party's files, `.kit/scratch/` outside its
       subfolder among them, and nothing outside the git root. Its
       `git show HEAD:<path>` baseline and restore copies, taken before the
       first mutation, live there, removed file by file, never as a directory.
       It reports any such need as `BLOCKED`, naming act and target. The
       brief's workspace constraints bind, naming each holder and the
       operations it puts off-limits, and override the box-budget clause's
       discretion over that state
     - Every load-bearing technical assertion you make marked confirmed,
       naming its evidence (file:line, the command run); inferred, saying to
       verify it before use; or reported, naming the peer session and saying
       the same. A claim about what a tool prints is confirmed only by a run
       of it or by the source line that emits it, the source preferred where
       in reach, since a run exercises one branch, and never by document
       agreement
     - The standing absence-check clause: a green alone reports neither of
       its two classes. Name in words which rule refused each case of a
       refusal check, since the class is any check whose acceptance is a
       refusal, because a check that records only that something refused
       reports the same green whether the rule it was meant to exercise
       refused it or another rule refused it first. For an absence check,
       such as a clean sweep, an empty grep or a contention gate reading clear, name the
       predicate, the scope and what it matched, an empty match stated against
       both, since the class is any check whose acceptance is an absence,
       because a predicate narrower than the class it guards reports the same
       clear verdict whether the state it was meant to detect is absent or
       merely unnamed. Report each site a sweep reached and left unchanged with
       the rule that exempts it. A control on an instance the pattern's own
       literals name proves only that the instrument runs, while one on an
       instance withheld from those literals, matched on its shape rather than
       a string the pattern was handed, is coverage evidence too. A check
       whose subject is a class states what would catch a member you did not
       name, a structural pattern over the class's shape where one exists.
       Where the class can be neither enumerated nor shaped, report the named
       members swept and the class not, never a clean sweep. Build the control
       in the agent's subfolder. A control that must touch the tree under
       review is a tree-mutating probe, carried here because an agent holds no
       skills: no other agent reads the tree while it
       runs, it restores from copies taken before the first mutation, and it
       runs as the wrapper `<root>/skills/testing-discipline/SKILL.md` states,
       under the runner's own hang limit with its restore in the exit path
     - Workaround bar: a workaround needing a paragraph to justify means fix the
       code or escalate
     - Promise check: the promises file's path and the command
       `node <root>/scripts/kit-jev-check.js promises <that file> <your changed
       source files>`, run before you report, with its closing line and every
       promise over 0.6 carried in the report
     - When returning NEEDS_CONTEXT on a hard question, state it consult-shaped:
       the decision, the options you see, the evidence, and your lean
     - Style-skill file paths (agents inherit no skills): resolve the plugin
       root at brief-writing time by the ladder `kit-doctor/SKILL.md` uses:
       `CLAUDE_PLUGIN_ROOT` where the harness provides it, which a session's
       own shell does not see, else this skill's own base directory's
       grandparent. Write `<root>/skills/<name>/SKILL.md`, plus its
       references/ file where one exists, into the brief as an absolute path.
       A versioned cache path under a marketplace install is correct when
       resolved this session. Resolve fresh every time, and never write a
       resolved root into this bullet as a literal
     - Build + test commands
     - [any section whose work may spawn a suite, build, or embedding pass]
       The standing box-budget clause, an act at the spawn step rather than a
       preamble constraint, because a brief is minutes stale by its first
       spawn. Immediately before each spawn, poll the process list for a
       foreign test runner or build, whatever its engine, then wait on it or
       name the contention in the report. Its owner is the doctrine's bullet
       led "One heavy process at a time is a per-machine budget, not a
       per-directory one."
     - [section whose files in scope include a settings permissions block, a
       hook that emits an allow or deny decision, or any other surface that
       composes or widens a command grant] The two-question grant audit, copied
       verbatim from `<root>/agents/security-reviewer.md` by the same ladder. A
       grant failing either screen is narrowed, or returned to the main thread
       with the reason, rather than written
     - [below-fable session, fable tier] The explicit fable model override,
       passed only after step 1's capacity reading; the spec's tier
       assignment is the authorization
     ```

     Every dispatch carries every REQUIRED field and each conditional field whose condition holds. An older spec's header may carry a legacy spend-authorization line (an expected Fable surface, a Fable-led-session marker, or a hold at the session model). It is inert: read past it, note it in the first Chapter that touches the spec, and honor nothing it says. The orchestrator stays lean. It reads no file beyond the approach-confirmation read above and never re-implements the agent's work. It reads the agent's diff only to verify and adjudicate it.
   - **Before any dispatch that passes a `fable` model override, take the capacity reading.** Run `node <plugin-root>/hooks/capacity-read.js`, resolving `<plugin-root>` by the style-skill bullet's ladder above, and act on the one line it prints. `-> dispatch` proceeds unchanged. `-> ladder governs`, or a run printing no verdict line whatever its exit code, proceeds under the never-started rules of finishing-work's unavailability rule. `-> downgrade` measures the fable tier exhausted for this dispatch. A reviewer or judge site takes `references/review.md`'s dispatch table row "Gate compensation" where finishing-work's ladder leaves it open, a consultant site dispatch table row "Consultant stand-in", the plan review and the altitude interview wait for fable per brainstorming, and an implementer site takes the stall raise rather than a lower model: `SKILL.md`'s `BLOCKED:` stop handing me the section, its first line quoting the reader's line. Quote the reader's line verbatim in the dispatch record and the Chapter. Take the reading immediately before each dispatch and never reuse it, because the machine's account rotator can change the active seat between any two dispatches.
   - **`Locus: inline` (or no tier recorded):** implement in the main thread at the session's own model. Inline is for sections the plan marked unbriefable or too small to brief. Dispatch a clearly briefable untiered section at the tier it would have earned. Read an older decorated `Model:` value (`fable (inline)`) as `Locus: inline` at that tier, correcting the line while in the file. Follow the csharp-style and sql-style skills and each one's precedence rule. Surgical changes only.
   - **Handle the implementer's status.** A NEEDS_CONTEXT whose add-decision line names a mechanism no Goal sentence, Intent clause or acceptance bullet names goes to step 4's design stop and its judge. A question the spec or the conversation answers is answered, and the section re-dispatched at the same tier. A genuinely hard one, the spec silent because nobody foresaw it, convenes a consult. The adopted ruling goes to the plan doc's `Standing Brief Amendments` block under step 4's adoption trigger, then into the re-dispatch brief. A preference fork that survives the ruling comes to me, ruling attached.
     - BLOCKED: fix the environment and re-dispatch.
     - **A request past the section's `Tests:` allocation** is answered from the plan's `Test Reserve:` under brainstorming step 12, which owns the reserve. A granted test joins the section's fix round.
     - DONE_WITH_CONCERNS: a material concern re-routes to NEEDS_CONTEXT handling. A "spec ambiguity you resolved" is a route (b) assumption for the Chapter's `Assumptions:` line, with the section number. Resolve a correctness or scope concern yourself, or put it to the adversarial-reviewer as a question, never as a pre-rated finding and never to the blind-reviewer, whose input contract excludes intent. Record a bare observation in the Chapter.
     - **A surface outside the section's Files in scope is never a bare observation.** One named in a report of any status takes step 4's out-of-scope route.
   - **Tier escalation.** Every dispatched section escalates after two failed review rounds or two NEEDS_CONTEXT returns on the same question. A round fails when a correctness lens in `references/review.md`'s step 3 roster returns a Critical that survives adjudication, save on a below-tier fix writer's delta. A refusal stop is a returned final message declining the work with no DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT or BLOCKED status, so it is a failed round and never a stall. The failed attempt's report and the review findings ride in the escalated brief.
     - Before any bump off a second failed round, compare the two rounds' surviving correctness-lens Criticals and name the result in the Chapter. A repeating finding class, NEEDS_CONTEXT twice on the same question included, means the implementer is missing something, so escalate. No repeat means the spec's premise is the generator, which a stronger implementer cannot fix. Spend no bump. Convene a consult on the premise with the claim under doubt and both rounds' findings, and bring me only the preference fork that survives it, ruling attached.
     - A Fable-led session takes the section over in the main thread. In a lower-model session, a section tiered below fable gets one capacity-gated re-dispatch to `implementer-fable` with the `fable` override, then the main thread, and a `-> downgrade` reading takes the stall raise instead. A fable-tier section exhausted after its second failed review goes to me as a stall raise or to a Fable-led session, never to a lower-model main thread. **An implementer never takes compensation.** A fable-tier section run lower keeps its pinned effort, and step 3's compensation paragraph says why.
     - A dispatch stopped on the wedge hallmark, or faulted synthetic-only, is an environment fault rather than a failed round, counted against neither the two-failure ladder nor the third-dispatch bar. It gets one re-attempt, for a synthetic-only fault the same-model retry finishing-work's rule spends. Where that also stops, record the chain and each dispatch's shape in the Chapter, and leave to finishing-work whether the tier can run here. A fable-tier section then takes the stall raise, any other tier escalates one tier, and a section already at the strongest tier this session can reach raises the stall.
     - Never re-dispatch a third time at the same tier, and never downgrade a section's tier mid-effort. Step 4's fix writer is not a downgrade.
   - **Subagents neither commit nor stage, under any commit model.** You stage what you accept, and that explicit `git add <paths>` after review is the scope check. Before every commit, take the staged-list read the doctrine's Scope and safety rule states. Only the main session commits, after review or at a first-green commit, and step 7 says which commit models allow the second.
   - **A quiet agent is a working agent, short of the wedge hallmark.** Transcripts go silent through long tool calls, so wait for the completion notification. Load finishing-work's unavailability rule, which owns the hallmark and its windows, at the section's first dispatch, since a rule loaded at suspicion arrives after the multi-hour wait it exists to end.
   - **The first-turn reading catches the never-started shape within minutes.** Take the reading at the first wake at or after the first-turn window closes, per finishing-work's rule. A dispatch carrying a model override takes it at that wake, whatever woke the session.
   - **This wait-shape bullet chooses between the wait shapes the completion contract's dispatch bullet states.** The synchronous call is wedge-blind, since no probe or status read fits inside it and a wedged call never returns, so take it only for a short single critical-path dispatch whose turn continuity is worth that price. Every other dispatch takes the `WAITING:` turn end, as does a dispatch carrying a model override, whatever its length. `TaskOutput` is read for status and never blocked on. A wake without a completion, from a peer message, an operator redirect or a timer, takes the reading it allows, answers what woke you, and ends the turn again on `WAITING:` naming the ids still pending. Never hold the turn open for a window to close, since that queues the next message behind it.
   - **Stop first.** Never dispatch a second implementer at the same files on a suspicion of stalling. TaskStop an agent before replacing it. The same applies when a decision changes a brief mid-flight: the in-flight agent executes a contract the new brief invalidates, so kill it and re-dispatch with the corrected brief.

2. **Verify with evidence.** Before step 3, run the build and targeted tests and require them to pass, and run each instrument the section's `Verify:` line names, even when an implementer reported DONE, reading each verdict from its own exit code. An observation row's reading is recorded instead. A failing instrument is fixed before step 3. A claim of "done" or "passing" carries the output that proves it against the start-of-work statement. Report every gate number with the state of the tree it was measured on, such as a clean worktree at sha X or the main checkout with N foreign dirty files. A gate number in a journal-layer artifact carries its moment in the form the moment-pin bullet of `skills/test-gates/SKILL.md` under the kit plugin root states. For delegated work, read the implementer's diff (`git diff`, since their work arrives unstaged) and spot-check the reported evidence rather than re-running everything. Re-run anything that looks off. A delta in that diff a guard should have refused takes step 3's incident path.

   **Hunt the fail-dangerous patterns specifically:** a delete-everything-not-in-this-set with no empty-set guard, a destructive loop under one outer try/catch, a hardening change that turns a benign path into a throw without auditing its callers. Hunt too the call-site bugs implementer code introduces that pass "no suites failed": a parameter name or type that does not match the callee, a silently changed error semantic (truncate instead of hard-fail), a hard-delete flipped to soft, an explicit NULL overriding a column default. Settle the test question per `skills/testing-discipline/SKILL.md` under the kit plugin root, whose litmus decides what earns a durable test: leave a durable test and show it passing, watching it fail first. If no test was warranted, say so and why. Use the temporary repro-script discipline from the global rules for debugging, never as the home for new behavior.

   **A tree-mutating probe is exclusive.** Run one under the doctrine's rule for it in Tests and Their Blind Spots, awaiting or TaskStopping every subagent first. When the state under test is already committed, run it in a separate worktree, which needs no exclusivity.

   **Then run the promises check before step 3:** `node <plugin-root>/scripts/kit-jev-check.js promises .kit/scratch/<plan-slug>/promises-section-<n>.json <the section's changed source files> --record .kit/scratch/<plan-slug>/promises-section-<n>.record.json`. Re-read each promise over 0.6 against the code, then fix it or record one `Decisions / Surprises:` line. After a fix, re-run once without `--record`. Step 3 dispatches whatever the reading, and no reading enters a review brief. A `not checked` or `not configured` line is recorded as printed and never retried into a pass.

## Delegating to Subagents

The orchestrator stays the designer: it writes dispatch prompts, judges findings, reads implementer diffs, and writes Chapters. Keep a task in the main session only when it is design-entangled, tiny, or session-state-dependent: its shape still emerging from the code, a prompt that would cost more than the work, or an in-flight debugging chain.

A subagent loads the skill catalog and, where the machine's CLAUDE.md imports it, the kit doctrine, but no skill bodies, conversation, in-flight directives or kit memory context. So assume no memory arrived, and carry any memory bearing on the section in the brief. Forward every standing directive verbatim, the style contract and the exact constraint among them.

**Write the dispatch prompt from the actual current code,** assuming a skilled engineer with zero context for this codebase. The Dispatch Brief template in step 1 names the fields.

**Hand bulky inputs over as files:** the spec, or a diff captured with `git diff > .kit/scratch/<name>.diff`. Keep the project's `.gitignore` covering `.kit/`. The blind-reviewer is the standing exception: it takes the base ref or changed-file list per step 3's contract, never a captured diff.

**A subagent's report comes back in its final message, not as a committed file.** Distill its durable outcome into the Chapter. A large review may return the verdict, the Critical/Major/Minor counts and the top finding inline, with the full findings in a `.kit/` file read only when adjudicating. The same discipline applies to read-only scouts, whose return contract is below.

**Parallelize only when tasks touch non-overlapping files.** Lock shared contracts first and assign disjoint files.

**Stagger concurrent sections.** Advance them offset: one being briefed, one implementing, one in review. Run steps 4 through 8 for a section the moment a round's step 4 ends with nothing blocking its close, which is a fixes-then-re-review cycle clearing at its final round's adjudication, and never batched with siblings. A step 8 close reached while siblings are in flight appends an interim board entry beside its Chapter, carrying the closure-drought rule's content list.

**A brief grants nothing a mechanical guard denies.** Where a PreToolUse guard keys on agent type, widening the agent's file scope in the brief leaves the write blocked. Route around it at dispatch time: send an agent type the guard admits, keep the guarded write in the main thread, or have the agent return the text for the main thread to place. Step 1's `docs/` routing override is this rule's standing instance.

**A brief forbids nothing the guard does not govern.** `readonly-agent` binds only the types its own classifier names. So a scout dispatched as Explore or general-purpose, or a Workflow `agent()` call naming no `agentType`, carries Bash the guard never reads, and its brief's read-only instruction is a request, not a control. Bracket every read-only-intent dispatch under an ungoverned type with `git status --porcelain` before dispatch and again at return, any delta taking step 3's round-bracket incident path. The named types are instances, not the boundary, so a type you cannot place as governed gets the bracket.

**Band the scout by question shape, and state its return contract.** A closed fact-check (does X contain Y, confirm a value) rides the harness default. Open discovery (map a surface, find every call site) gets an explicit sonnet override. Never dispatch top-model recon. A "simple check" that returns more than a couple of leads was mis-banded, so re-run it as discovery. Each lead comes back as a file:line reference with a one-sentence fact and why the site matters, never pasted file contents, and bulky evidence goes to the `.kit/` scratch path, read on demand.

**Serialize what the environment cannot share.** Implementation that touches shared state stays single-agent-per-worktree, and the long integration suites follow the doctrine's sequencing bullet.
