---
name: testing-discipline
description: "Discipline for which tests a change earns and keeps. Use when writing a test, deciding whether a change earns one, reading a section's Tests: line, spending or asking past a section's test allocation, or judging whether a test already in the tree still earns its keep. Triggers: a new test or test file, a test whose subject moved or was deleted, a suite audit, a test that reds on every intentional edit, a test reaching for a port, a spawn, a database or shared state, a test that waits out a real timeout. Lanes, reading a red, the clock and the mutation audit live in test-gates."
---

# Testing Discipline

A test is a liability bought on the hope of future information. The session that writes one sees the purchase price, which is near zero, and never the carrying cost, which is paid at every gate for the life of the project. This skill makes the carrying cost visible at the moment of purchase. Lane mechanics, the red protocol, the clock and the mutation audit live in `skills/test-gates/SKILL.md` under the kit plugin root.

## Triage

**A change earns no test until a candidate passes two questions, in order.** The default is no because the suite's cost grows with every test that gets in, and nothing else in the loop pushes back.

The first question is what defect this test would catch. The answer names a failure of the code, never a function. "Covers X" is not an answer. A candidate with no answer is not written.

The second question is whether a session could make the change this test forbids on its own authority, with nothing else needing to change. Where it could, the test pins a choice rather than a requirement, and it is not written. Where a caller, a guard, a reader of the same value, or a shipped surface that states or depends on the pinned thing would have to change, it pins a requirement. The first question culls the tests that cannot fail meaningfully. The second culls the tests that fail on legitimate edits, which the first lets through, since a mirror of a function's body can always name a defect.

**The section's `Tests:` line is the floor and the ceiling.** It names the contracts the section must pin, and it names the allocation the section may spend on them, as a count of tests or of test lines by layer. The implementer spends inside it. A candidate the triage passes that the allocation cannot hold goes to the orchestrator as a request naming the contract and the second surface, and the orchestrator grants it from the plan's reserve or declines it with a reason. A candidate is never written first and justified after. A fix round draws from the reserve too, and only the regression test for a defect that actually happened draws without asking. The reserve is a plan header, and the brainstorming skill states how the architect sets both.

**A lower tier is told what to pin, never left to decide whether.** A sonnet section's `Tests:` line names each contract and the shape of its pin. A fable section may be handed the triage and the allocation and trusted to argue past it.

## What Earns a Test

A test is written for a contract whose break no gate short of a test reliably catches. The second question above is how a candidate shows it is one. The following land that class and do not close it.

- **An acceptance criterion** earns a test only after it passes the second question. An implementer's criterion written as "returns X for input Y" is a choice unless a second surface depends on X.
- **A path no human drives by hand**: a hook, a CLI, anything only machines exercise.
- **A cross-surface pin**: a writer and a reader share a value, such as a wire field, and each side tested only against its own literal hides a mismatch. A pin reading shipped prose normalizes `\r\n` to `\n` first, or it reds on a `\r\n` checkout.
- **A defect that actually happened**: the regression test pins the fixed cause on a stable form, such as a token or a direction, never on the sentence the fix wrote. A defect commit does not exempt a wording pin from the wording class.

**A requirement test is written from the contract before the code, against the public entry point.** A test written after the code describes whatever the code happens to do, and that is where mirrors come from. A set that code reads at runtime to allow, deny or route is a requirement where the test derives at least one side from source. A count, a default, a configuration value, a wording or a menu's membership is a choice wherever only the test states it, or another surface states it only as a current value. Beside a requirement, reshape the test to pin the requirement alone. A requirement stated only in `docs/security-model.md` gains one sentence at the guarded code. A whole-tree pin takes the same question. One asserting that two surfaces agree pins a requirement. One asserting that every family member meets a policy pins a choice, unless a shipped surface states the policy.

**The flag case:** what a flag is set to in a configuration is a choice, and it is not pinned. Beyond the both-ways proof in the doctrine's "Make the test earn its green" bullet, a flag's requirements are the direction a guard takes on unreadable input, an unparseable value degrading rather than throwing, and the exact value that disables a guard. A throw in a hook that swallows errors is a silent allow.

**Prefer one whole-tree pin to a test per function.** The shape that catches real defects is an invariant pinned across the whole tree: a roster or reflection pin over a family, a derived pin that scans a source file, a cross-surface count assertion, a region-extraction test over real code, a fixture self-check. Any assertion that visits every member of a family and fails when one drifts is in that class. When a family gains a member, extend the family's pin, or write its first, rather than giving the member private function mirrors.

**Some shapes decline without the triage.** Framework behavior, anything the type checker already catches, a getter, a private helper, and a mock's own behavior pin nothing the code owns.

## What Retires a Test

A test in the tree retires when it falls in one of these classes, and a candidate that falls in one is not written. Where the contract still needs cover, the repair replaces the deletion: a wording pin is re-pinned on a stable form, and a moved contract's test is repointed at its new home.

- **An implementation mirror**: a test restating a function's body, which breaks on every intentional edit and sleeps through defects.
- **A count pin a sibling leg already covers**: a hardcoded count that another assertion in the same suite already checks. A count each side derives independently stays, and so does one that is the only detector of a symmetric removal.
- **An exact-wording pin on prose no identity contract covers**: an assert on stderr, stdout or a curated sentence where an exit code, a stable token or a machine-read field would leave the wording free. A text two or more surfaces carry by design keeps its byte-identity pin.
- **A duplicate**: a test whose failure implies another's and which catches nothing the other misses. A fast test subsumed by a slow one still buys a red that names the broken unit, and keeps its place while its clock stays in milliseconds and the second question still passes it.
- **An orphan**: a test whose contract no longer exists; one whose contract merely moved earns a repointed test.
- **A pin on a choice**: a test that goes red on an edit a session could make on its own authority with nothing else needing to change. A test `docs/security-model.md` cites as a control, or as the only mechanical trace of a prose-enforced requirement, retires only in a section that amends that document to say what replaces it. Search the document for the test's file name and read the citing paragraph. Where it describes another test in the file, or says the file is not the control, no amendment is owed, and the Chapter's retire line says so.

A control leg is none of these, per the doctrine's withheld-control bullet ("A silent check earns its silence with a withheld control").

The six are instances of one class: a test whose maintenance cost is not paid for. Its red indicates no defect, or it stays green while the behavior it pins breaks, or the defect it would catch is caught elsewhere, or its contract is gone. A candidate in that class is not written and a test in it retires, even where no item names it. The mutation audit in `test-gates` measures the second and third symptoms, and the first only a reader can judge.

**The lifecycle:** new code adds tests. Changed code adds tests and retires the ones its change orphans or turns into pins on a choice. Removed code removes its tests. Before writing a test, read the file it joins, since that read finds the fixture to share, the sibling that already covers the contract, and the convention to match. A section whose own change reddened or edited an existing test names each in its Chapter and rules it a defect, a contract change the plan names, or a choice. A red ruled a choice retires or reshapes the test in the same section. It is never settled by widening the assertion to admit the new value.

## Three Currencies

**Every test the Chapter adds carries one line: the contract, the second surface, and its cost.** The line is what makes over-testing visible at review, since a reviewer cannot see a pointless test in a diff of passing green. Tests the triage declined ride the same list, with the question that declined them. A section that adds tests and retires none says why.

A test's cost has two currencies and its worth has one. What it costs to keep is its lines, which the Chapter's gate line reports as test lines over production lines for the section, from `git diff --numstat` against the base, counting only files the whole-gate merge rule in `test-gates` calls code files. What it costs to run is its clock, which the gate line reports per the slowest-files bullet there. What it buys is the defects it alone would catch, which only the mutation audit measures. A good test is high on the third and low on the first two. The ratio and the clock are reported, never enforced, because an enforced number is gamed within a week and a reported one is read.

## Shared Setup

**Any cost paid per test that could be paid once is paid once, at the widest scope the test's isolation allows.** A spawn per assertion becomes a spawn per batch, a fixture per test becomes a fixture per class, and a database per class becomes a database per collection with each test isolated by a transaction or its own keys. Ten tests that each loaded the same data took ten times the clock of one, and loading it once took them to 1.1 times.

**When every test in an area shares the setup that avoids a hazard, green proves the behavior only under the one condition where the failure cannot happen.** So when an area's setup is uniform, ask what the uniformity avoids, and pin that hazard with one test that does not share the setup. The two rules sit together because the first creates the condition the second guards.

**Tests on one fixture whose mutation kill sets are identical are tests whose assertions pull no weight.** A kill set is the fixture's kills plus the assertion's, and a family with one kill set has assertions that detect nothing the fixture's construction does not already detect. Each member stands on the first triage question alone, which is enough where the defect it names is one the mutator cannot produce.

## Price the Shape at Authoring

Any shared resource that could be owned is owned, as a fixed port becomes an owned temp dir. For a test that spawns a process, directly or through a shared helper, or builds a fixture per test, the Chapter names the file it joins and the spawn sites it adds.

**A test never waits out a real timeout.** A test proving "we give up after N seconds" by spending N seconds charges the suite N seconds on every run for the life of the project. The timeout is injected and the test spends milliseconds proving the same contract.
