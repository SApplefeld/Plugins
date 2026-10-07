---
name: testing-discipline
description: "Discipline for which tests a change earns and keeps, and which run after it. Use when writing a test, deciding whether a change earns one or whether a test already in the tree still earns its keep, choosing which tests to run after a fix, or reading a red or a wall-clock figure. Triggers: a new test or test file, a test whose subject moved or was deleted, a suite audit, a test that reds on every intentional edit, a fix round tempting a full-suite re-run, a suite that reds only beside a busy neighbor, a wall clock that grew, a test reaching for a port, a spawn, or shared state."
---

# Testing Discipline

Lane commands are per-repo facts, so look each one up in that project's memory tier. Nothing in this file is a command to run.

## What Earns a Test

A test is written for one of these:

- **An implementer's acceptance criterion**: the behavior the section was dispatched to produce.
- **A path no human drives by hand**: a hook, a CLI, anything only machines exercise.
- **A cross-surface pin**: a writer and a reader share a value, such as a wire field, and each side tested only against its own literal hides a mismatch. A pin reading shipped prose normalizes `\r\n` to `\n` first, or it reds on a `\r\n` checkout.
- **A defect that actually happened**: the regression test pins the fixed cause on a stable form, such as a token or a direction, never on the sentence the fix wrote. A defect commit does not exempt a wording pin from the wording class.

The list is instances of one class: a contract whose break no gate short of a test reliably catches. A candidate that pins such a contract earns its test even where no item names it.

**Requirement or choice:** a candidate that passes that class faces a second question. Could a session make the change this test forbids on its own authority, with nothing else needing to change? Where it could, the test pins a choice rather than a requirement, and it is not written. Where a caller, a guard, a reader of the same value, or a shipped surface that states or depends on the pinned thing would have to change, it pins a requirement. A set that code reads at runtime to allow, deny or route is a requirement where the test derives at least one side from source. A count, a default, a configuration value, a wording or a menu's membership is a choice wherever only the test states it, or another surface states it only as a current value. Beside a requirement, reshape the test to pin the requirement alone. A requirement stated only in `docs/security-model.md` gains one sentence at the guarded code. A whole-tree pin takes the same question. One asserting that two surfaces agree pins a requirement. One asserting that every family member meets a policy pins a choice, unless a shipped surface states the policy.

**The flag case:** what a flag is set to in a configuration is a choice, and it is not pinned. Beyond the both-ways proof in the doctrine's "Make the test earn its green" bullet, a flag's requirements are the direction a guard takes on unreadable input, an unparseable value degrading rather than throwing, and the exact value that disables a guard. A throw in a hook that swallows errors is a silent allow.

**The price:** a test costs its wall clock at every future gate, plus every edit that reds it with no defect behind it, so it is written only where the break it would catch costs more. For a test that spawns a process, directly or through a shared helper, or builds a fixture per test, the Chapter names the file it joins and the spawn sites it adds.

**Prefer one whole-tree pin to a test per function.** The shape that catches real defects is an invariant pinned across the whole tree: a roster or reflection pin over a family, a derived pin that scans a source file, a cross-surface count assertion, a region-extraction test over real code, a fixture self-check. Any assertion that visits every member of a family and fails when one drifts is in that class. When a family gains a member, extend the family's pin, or write its first, rather than giving the member private function mirrors.

## What Retires a Test

A test in the tree retires when it falls in one of these classes, and a candidate that falls in one is not written. Where the contract still needs cover, the repair replaces the deletion: a wording pin is re-pinned on a stable form, and a moved contract's test is repointed at its new home.

- **An implementation mirror**: a test restating a function's body, which breaks on every intentional edit and sleeps through defects.
- **A count pin a sibling leg already covers**: a hardcoded count that another assertion in the same suite already checks. A count each side derives independently stays, and so does one that is the only detector of a symmetric removal.
- **An exact-wording pin on prose no identity contract covers**: an assert on stderr, stdout or a curated sentence where an exit code, a stable token or a machine-read field would leave the wording free. A text two or more surfaces carry by design keeps its byte-identity pin.
- **A duplicate**: a test whose failure implies another's and which catches nothing the other misses.
- **An orphan**: a test whose contract no longer exists; one whose contract merely moved earns a repointed test.
- **A pin on a choice**: a test that goes red on an edit a session could make on its own authority with nothing else needing to change. A test `docs/security-model.md` cites as a control, or as the only mechanical trace of a prose-enforced requirement, retires only in a section that amends that document to say what replaces it. Search the document for the test's file name and read the citing paragraph. Where it describes another test in the file, or says the file is not the control, no amendment is owed, and the Chapter's retire line says so.

A control leg is none of these, per the doctrine's withheld-control bullet ("A silent check earns its silence with a withheld control").

The six are instances of one class: a test whose maintenance cost is not paid for. Its red indicates no defect, or it stays green while the behavior it pins breaks, or the defect it would catch is caught elsewhere, or its contract is gone. A candidate in that class is not written and a test in it retires, even where no item names it.

**The lifecycle:** new code adds tests. Changed code adds tests and retires the ones its change orphans or turns into pins on a choice. Removed code removes its tests. A section that adds tests and retires none says why in its Chapter. A section whose own change reddened or edited an existing test names each in its Chapter and rules it a defect, a contract change the plan names, or a choice. A red ruled a choice retires or reshapes the test in the same section. It is never settled by widening the assertion to admit the new value.

## Shared-Setup Blind Spot

When every test in an area shares the setup that avoids a hazard, green proves the behavior only under the one condition where the failure cannot happen. So when an area's setup is uniform, ask what the uniformity avoids, and pin that hazard with one test that does not share the setup.

## Price the Shape at Authoring

Any cost paid per test that could be paid once per process is paid once, as a spawn per assertion becomes a spawn per batch. Any shared resource that could be owned is owned, as a fixed port becomes an owned temp dir. Configure the runner parallel from day one, so a dependent test fails at birth rather than at the retrofit. A real spawn belongs only where a shell, a CLI or a cross-process boundary is the subject.

## Test Lanes

The doctrine's gate bullet ("After each step, run the lane the moment calls for, and report the delta") names which moment takes which lane.

- **The targeted lane** is the changed files' tests plus any whole-tree pin whose subject those files are. A change to a family member runs the family's pin whatever file it sits in.
- **The whole gate** runs at finishing, before the plan's handoff. Finishing and the handoff are one moment rather than two: finishing's own full-suite run is the gate the plan hands off on. A plan pays one green finishing run, and every change after it takes the targeted lane over its own delta. The one whole gate is the run that ends green: a red of the plan's own is fixed and re-run whole, since none has passed yet. A red the integration branch's head carries too is the trunk's, and the base-head bullet below routes its fix, which the plan's branch takes in on the targeted lane that bullet states. A gate whose only reds are the trunk's is the one paid once each of them is fixed or has become a spec. A merge takes the whole gate only where a code file conflicted or both sides changed one. Any other merge takes the targeted lane over the files either side changed. A trunk red's fix is the one exception, which the base-head bullet below states. Each side's changed files are those `git diff --name-only <merge-base> <side>` lists, and both sides changed a code file only where the same one appears on both lists. A code file is one that runs or is loaded by what runs. That covers a source file, a script, a hook, a test file, a query or schema file, and a config file a hook, script or program reads to decide what it does, a settings file or a plugin manifest among them. Three kinds are not code files for this rule: markdown, a skill's `SKILL.md` and a probe included; plain text; and a budget or fixture file that only tests and the tool maintaining it read, as `test/size-budget.json` is. The targeted lane of each of those runs the tests that read it. A merge whose diff touches the sources a local build artifact is stamped from rebuilds before it gates. The merge leaves the stamp stale with no conflict to flag it. In the kit repository those sources are the files under `plugins/grimoire/hooks/`, rebuilt with `build.ps1` or `build.sh`.
- **The contention lane** holds the tests whose subject is genuinely machine-shared state (a machine-global tier, a real shared lock), each saying so in its own text. It runs serially, beside the whole gate wherever the whole gate runs, and at section close whenever that section's delta touched the lane's subject. A main-gate test that needs the box to itself moves here, which is the fix, rather than the main gate being retried until it passes.
- **The whole gate's baseline is the base head.** No plan runs the whole gate at its start to record a baseline. The finishing gate runs once, after the plan's branch has taken in the integration branch. Where the gate reds any test file, add one worktree under the project's `.kit/` scratch path at the integration branch's commit that merge took in, built first where the project's tests read a build output. Where no merge took the integration branch in, as under Review-Only or Commit-and-Push on the trunk, the worktree sits at the effort's base ref, which finishing-work's base-ref paragraph derives. Run each red file there alone with the project's own test command, then remove the worktree. The re-run takes its own worktree because a whole gate reads the tree live, and the finishing pass is still editing the plan's tree. Each base-head result rides the Chapter's `Gate:` line beside the gate's own counts, as `base head <sha>: <file> <pass>/<fail>`. A file red on the branch alone is the plan's, fixed on the plan's branch. So is a file the base head does not hold, which rides the line as `absent` in place of its counts. A file red on both sides is the trunk's. The red protocol below still names it flake or regression, and then the session fixes it before the handoff, on a branch cut from the trunk with a pull request of its own. That fix takes the targeted lane over the failing file, and the plan's branch merges the trunk again once it lands. That merge takes the targeted lane over the files the fix changed, even where the plan changed one of them too, and any other file it brings across takes the merge rule the whole-gate bullet above states. A red whose fix is a design of its own becomes a spec instead. The handoff waits on that pull request or that spec. A trunk red never goes to the kaizen inbox or the backlog, since a red left for later stays red for every plan after this one.

When a repo first defines its lanes, record their commands in that project's memory tier.

## Reading a Red

A red is discriminated by protocol, not by re-running the world:

1. **Capture the exit code and the discriminating output from the run itself**: a foreground run's own exit status, or a backgrounded run's marker and the error text in its own log. Where the environment refuses the marker compound, read the run's own summary output after the notification instead.
2. **Solo, then class, then a full re-run with no code change, then a clean tree.** Solo separates the test from its neighbors. The class run separates the fixture from the box. The unchanged full re-run separates the code from the machine. The same red at the integration branch's head, re-run in a clean worktree, or in the lane baseline you recorded, separates a red that was there before you from one you caused.
3. **Name it flake or regression, with the reason, before moving on.** The reason cites the discriminating output from step 1, never the timing or the feel of the failure.

A red seen with another suite, build or embedding pass on the box that passes on a solo re-run is contention evidence. It goes to the kaizen inbox as a note stating which suite cannot share the box with what, whatever repository the suite belongs to.

## Clock and Box

- **Capture the clock with the baseline.** Record the suite's wall clock beside the baseline's pass/fail counts, and name the lane the baseline ran on. The whole gate's clock is read against the previous plan's finishing Chapter on the same machine, which sits under `docs/archive/`, or recorded as having none there, since no plan-start run records one. Growth established under the contention rule below, past a few minutes, is a finding to route, never a fact of life to absorb.
- **Moment-pin a measured figure.** A measured figure recorded in a journal-layer artifact carries a moment-pin: what produced it, when, on which machine, and under what contention. The machine is part of the pin, since the configuration epoch a figure is read against is recorded per hostname, and the memory-system skill owns that record and the expiry rule that reads a figure against it. The doctrine's journey ban ("Documents ship the current state; the journey lives in git") defines the journal layer, so a curated document, a code comment and a skill body carry no dated-evidence annotation. Within a plan doc, pinned figures sit only in its Chapters, its interim board entries and its Evidence section. Deep evidence behind a figure, such as a scatter analysis, lives in memory or in that Evidence section, and a journal line cites it there.
- **Record the contention beside the clock.** Every wall-clock figure carries the box's process count and free memory, captured at the run. Growth is a finding only against a baseline at comparable contention or a same-conditions trend.
- **Check the box before any suite.** Poll as the doctrine's machine-budget bullet ("One heavy process at a time is a per-machine budget, not a per-directory one") states, counting a runner or build whatever its engine, whether owned by another session or by a running engine. The poll is a sample, never a clearance. It cannot see in-process agent fan-out, which spawns no engine, and it cannot see a neighbor that starts after the sample and before the suite. A clean poll is a basis for starting and never proof the box is empty. A machine-state sentence leaving the session names the poll and its age, or says "not polled this turn".
