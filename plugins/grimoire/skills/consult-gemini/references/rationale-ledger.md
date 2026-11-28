# Rationale ledger: consult-gemini

This file is the rationale ledger for the documents the `consult-gemini` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, plan doc, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.

## plugins/grimoire/skills/consult-gemini/SKILL.md

This document is the Gemini consult skill: it sends one question to Google's Gemini model through the `agy` tool, by way of the `consult.sh` script and the `gate.js` hook in its own folder, and reads back the answer. It owns the outside read by Gemini: when a session takes one, whether the machine can run it, the standing grant that switches on unasked use, what leaves the machine, the tier, the run and how its result is read and reported. Its load class is `named-trigger`: its description pulls it in on a person's request to consult Gemini or Neon or for a second opinion from another model, and at the unasked moments it names, on a machine whose operator has switched them on.

Written by `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 on 2026-11-27: whole document (the `C` entries below, whose passages are read at that section's tree). The skill came from a user-level copy on one machine, outside every repository, and the plan's Approach states what it kept and what it changed so that the text holds on any machine.

### C001
- key: Load this skill when a person asks to consult Gemini or Neon, wants a second opinion from another model, or asks for a Gemini read of a design, a plan, a file or a log.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:3
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6, which holds the description to `test/skill-description.test.js`.
- verdict: keep
- reason: A person's request is the plain trigger, and naming Neon beside Gemini catches the model's own name, which is how a request for it is often worded.
- passage: Use when a person asks to consult Gemini or Neon, wants a second opinion from another model, or asks for a Gemini read of a design, a plan, a file or a log.

### C002
- key: Load this skill unasked only on a machine whose operator has switched unasked use on, at the three named moments.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:3
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, Approach paragraph "The switch for unasked use". Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "approval moment".
- verdict: keep
- reason: The description is all a session reads when it picks a skill, so it carries the switch's condition with the moments, and a session on a machine with no record is not pulled toward a consult the grant then refuses (C017).
- passage: Use it also, unasked, on a machine whose operator has switched unasked use on, for a consult on a large or hard-to-reverse plan beside its blind read, an audit or analysis over data, or a question the Claude consultant could not settle.

### C003
- key: Treat Gemini as an outside judge and never a builder, and weigh its answer rather than follow it.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:10
- provenance: carried from the user-level skill as it stood on 2026-11-27, which `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 copied and rewrote.
- verdict: keep
- reason: A model that holds none of the kit's doctrine questions what the kit does on purpose, which is the read's value. The same gap means its answer can be wrong about the kit's own reasons, so it is weighed and never followed.
- passage: Gemini is an outside judge, never a builder. It holds none of the kit's doctrine or skills, so it questions habits the kit builds in on purpose. That is the value, and it is also why its answer is weighed rather than followed.

### C004
- key: Run a consult a person at the machine asks for at any time, with no record needed.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:12
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6, Unasked Use: "A direct request from the person at the machine needs no record."
- verdict: keep
- reason: The person asking is the consent the switch stands in for, so a direct request needs no grant. The Availability check still governs whether the run can happen (C012).
- passage: A person at the machine may ask for a consult at any time, and that request needs no record.

### C005
- key: Run a consult unasked only where Unasked Use allows, at three moments: a large or hard-to-reverse plan beside its blind read during spec self-review, an audit or analysis over data, and a question the Claude consultant ruled on that still looks unsettled.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:12
- provenance: the three moments carried from the user-level skill as it stood on 2026-11-27; the condition from `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6. Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "approval moment".
- verdict: keep
- reason: Each moment is one where an independent read can catch what the kit's own reviewers share as a blind spot, and each is rare enough that the read's cost stays small. The condition comes first because a shipped skill fires on machines whose operators never accepted a route to Google (C017).
- passage: A session runs a consult unasked only where Unasked Use below allows, at three moments. A large or hard-to-reverse plan takes one beside its blind read during spec self-review, as `brainstorming` step 10 places it. An audit or analysis over data would gain from an independent consult. A question the Claude consultant ruled on still looks unsettled.

### C006
- key: On the architect seat, take a read on every plan before the seat queues it and on every proposal or finding before the seat answers it, under the same switch.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:12
- provenance: an operator ruling the user-level skill carried as its fourth moment; kept under the switch by `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6.
- verdict: keep
- reason: The architect seat writes the plans every worker runs, so an outside read there reaches every plan whatever its size. It sits under the same switch because an unasked read from the seat sends the plan to Google as surely as any other (C017).
- passage: The architect seat has a fourth moment under the same switch: every plan the seat writes takes a consult before the seat queues it, and every proposal or finding the seat weighs takes one before the seat answers it, whatever the plan's size.

### C007
- key: Never use Gemini to write code, documents or anything that ships, and never to take an action.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:14
- provenance: carried from the user-level skill as it stood on 2026-11-27; `docs/archive/claude-kit_engine-portability-proof_spec_v1.md`, which found that agy writes files unasked.
- verdict: keep
- reason: The read is a judgment, and a builder outside the kit's review and tests would ship work no gate has read. agy writes files without asking, so the rule is also what keeps the gate's read-only bound the intended use (C011).
- passage: Never use it to write code, documents or anything that ships, and never to take an action.

### C008
- key: Never use Gemini to review code, and check each of its claims against the code.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:14
- provenance: carried from the user-level skill as it stood on 2026-11-27, on the trial review it named. Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "trial narrative".
- verdict: keep
- reason: On a trial review of a merged change it invented function names, constants and spec text and missed both security findings, so a code review from it costs a reader more to check than it finds.
- passage: Never use it to review code either. Gemini can invent function names, constants and spec text to support a finding, and it can miss a finding outright, so check each of its claims against the code.

### C009
- key: Send Gemini the evidence and the question, never the session's own conclusions.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:14
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: A read that is handed the answer returns it, and an outside read is worth taking only where it can disagree.
- passage: Send it the evidence and the question, never your own conclusions. A consult that already states the answer only returns it.

### C010
- key: Consult only by running `consult.sh` in the skill's folder, the base directory the harness prints when the skill loads, and never by calling `agy` directly.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:16
- provenance: carried from the user-level skill as it stood on 2026-11-27; the folder's naming from `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6.
- verdict: keep
- reason: The script is what installs the gate and the net over credential shapes, so a direct call starts agy with neither. In the kit the folder is the plugin cache's, whose path differs per install, so the text names the folder the harness prints rather than a fixed path.
- passage: Consult Gemini by running `consult.sh` in this skill's folder, never by calling `agy` directly. The folder is the base directory the harness prints when this skill loads, written `<skill folder>` below.

### C011
- key: Know that agy writes files anywhere without asking, and that the script runs it in a fresh work folder whose hook allows only read-only tools on paths inside it.
- class: rationale-example
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:16
- provenance: carried from the user-level skill as it stood on 2026-11-27; `docs/archive/claude-kit_engine-portability-proof_spec_v1.md`.
- verdict: keep
- reason: The gate is agy's only containment, since its own sandbox flag does not stop writes, and a session that knows this keeps to the script (C010).
- passage: The script contains `agy`, which is a full agent that writes files anywhere without asking, even under `--sandbox`. The script runs each consult in a fresh work folder under the temp directory. A hook there, `gate.js`, allows only read-only tools on paths inside that folder.

### C012
- key: Expect exit 3 and one line opening `verdict: UNAVAILABLE - ` where the system is not Git Bash on Windows, agy is not found, or agy asks for a Google sign-in.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:20
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, items 2 and 6, on the operator's words of 2026-11-27 quoted in that plan's `## Intent`.
- verdict: keep
- reason: Most machines that install the kit hold no agy, so a caller needs one outcome that means "cannot" apart from a run that started and failed. Exit 3 is that outcome and nothing else, so a caller that reads it has no read to wait for. The script leans on `cygpath`, `cmdkey` and `taskkill`, which is why the system is the first case.
- passage: The consult runs only where three things hold. Where one fails, a run prints one line that opens `verdict: UNAVAILABLE - ` and exits 3, and a check shows a missing `agy` by its `agy: missing` line:
- passage: - the system is Git Bash on Windows;
- passage: - `agy` is on `PATH` or in `%LOCALAPPDATA%\agy\bin`;
- passage: - `agy` is signed in to Google. A run that meets a sign-in prompt is stopped within seconds.

### C013
- key: Run `consult.sh --check` before an unasked consult; it sends nothing, prints only the `verdict: UNAVAILABLE` line off Git Bash on Windows and otherwise whether agy is found and whether its sign-in is listed, and exits 0 where agy is found and 3 otherwise.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:26
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, items 3 and 6, Approach paragraph "A check that sends nothing". Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "check output".
- verdict: keep
- reason: A check that starts nothing tells a machine that cannot consult from one that can before any text leaves it, and it is the further condition the grant names (C022). It shares the shape of the explainer skill's machine check, `plugins/grimoire/scripts/explainer-preflight.js`.
- passage: Before an unasked consult, run `bash "<skill folder>/consult.sh" --check`. The check sends nothing, starts no `agy`, makes no folder and writes no log. Off Git Bash on Windows, it prints only the one `verdict: UNAVAILABLE` line and exits 3. Otherwise it prints `agy: found` or `agy: missing`, then `sign-in: listed`, `sign-in: not listed` or `sign-in: unknown`, and exits 0 where `agy` is found and 3 where it is missing.

### C014
- key: Read the sign-in line as a hint, and let a run's own verdict decide where exit 0 sits beside `not listed` or `unknown`.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:26
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, `## Intent` constraint: a saved sign-in can be listed and still fail, so only a real run answers "usable".
- verdict: keep
- reason: Windows can list a saved sign-in that agy then fails to use, and the listing read can answer `unknown` on a healthy machine, so a stop on the line would refuse runs that work. The run's own sign-in stop is the truthful answer, and it costs seconds.
- passage: The sign-in line is a hint, since Windows can list a saved sign-in that `agy` then fails to use. So a sign-in line reading `not listed` or `unknown` beside exit 0 does not stop a run, and the run's own verdict decides.

### C015
- key: On exit 3, run no further consult in that session unless the person at the machine asks, write `outside read: unavailable (<reason>)`, the reason being the verdict's or `agy is not installed`, where the consult would have been recorded, and carry on; a consult is never a gate.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:28
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6; the operator's rulings of 2026-11-24 and 2026-11-26 that the Gemini read is a value add and never a gate, which that plan's Assumptions name. Reworded by the plan's finishing pass, 2026-11-27, on the prose review's findings "person overrides" and "check output".
- verdict: keep
- reason: An unavailable machine stays unavailable until a person changes it, so an unasked retry spends time for the same answer, while a person who has signed in may ask again. The recorded line keeps the miss visible where the read was expected, and carrying on is what "fail gracefully" means for a caller.
- passage: On exit 3 from a check or a run, a session runs no further consult in that session unless the person at the machine asks. It writes `outside read: unavailable (<reason>)` where it would have recorded the consult, and carries on. The reason is the verdict's own, or `agy is not installed` after a check's `agy: missing`, which prints no verdict. A consult is never a gate.

### C016
- key: Tell the person at the machine of a sign-in stop.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:28
- provenance: carried from the user-level skill's sign-in row as it stood on 2026-11-27, which told the operator that agy needs a Google sign-in.
- verdict: keep
- reason: A browser sign-in needs a person at the machine, and no session can clear it, so the stop reaches the one party who can.
- passage: A sign-in stop is also told to the person at the machine, since only a person can sign `agy` in.

### C017
- key: Run a consult no person asked for only under a standing grant, the fourth instance of the role skill's rail, stated whole here.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:32
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6, on ask `ask-plan-mwz885zr-1dv7-1795799032460`, which the plan proceeds past on its default; the role skill's pointer is CO001 under its ledger. Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "thesis subject".
- verdict: keep
- reason: The operator's acceptance of Google covered a skill that operator installed on their own machine, and a shipped skill removes that act of consent on every other machine. An unasked consult sends text to an outside service, which the delegation's exclusions never cover, so it needs a grant of its own, and the rail is the kit's one form for that. The skill states it whole because its moments and its further condition are this skill's own.
- passage: A consult no person asked for needs a standing grant, the fourth instance of the role skill's standing-grant rail, and this section states that grant whole. An unasked consult sends text to an outside service, an act the role skill's delegation never covers.

### C018
- key: Scope the grant to one act: starting a consult no person asked for in that turn, at one of the named moments.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:34
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6.
- verdict: keep
- reason: The rail asks each instance to state its whole scope, and a scope of one act at named moments leaves no reach for a session's judgment of when else a read would help.
- passage: - **Scope:** one act, starting a consult no person asked for in that turn, at one of the moments under When to Use It.

### C019
- key: Key the switch to the host: the operator-tier record `<hostname>-gemini-consult-granted`, resolved with `memq get <name> --operator` and compared without case, as the delegation record is.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:35
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6; the role skill's delegation switch paragraph, whose keying it follows.
- verdict: keep
- reason: Whether agy is installed and which Google account it signs in with are facts of one machine, so the consent is that machine's. Following the delegation record's keying and compare means one rule resolves both, and no surface on the path holds a canonical case.
- passage: - **Scoping:** hostname-keyed. The switch is the operator-tier record `<hostname>-gemini-consult-granted`, `<hostname>` being the identifier `os.hostname()` reports, lowercased. A session resolves it with `memq get <name> --operator` and compares the name's identifier with `os.hostname()` without case, as the delegation record is compared.

### C020
- key: Take the record only as a `memq add-operator` write on the operator's instruction, and refuse one whose `author:` line names the session or any agent it dispatched, or one with no `author:` line.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:36
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6; the role skill's third refusal rule, that a seat cannot warrant a grant whose record its own causal chain wrote. Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "author reach".
- verdict: keep
- reason: A session that could write its own switch would grant itself the route to Google, so the record's `author:` line is the account the refusal rule reads, and a record with none cannot be accounted for.
- passage: - **Provenance:** a `memq add-operator` write on the operator's instruction. A session refuses a record whose `author:` line names its own session or any agent it dispatched, and a record that carries no `author:` line.

### C021
- key: Resolve the record before each unasked run.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:37
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6; the role skill's `references/grants.md` Instance Statements paragraph.
- verdict: keep
- reason: Revocation is the record's delete, so a read before each run is what makes a delete take effect at the next consult rather than at the next session.
- passage: - **Resolution moment:** before each unasked run.

### C022
- key: Act on the grant only where `consult.sh --check` exits 0 in the same turn.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:38
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6; the role skill's `references/grants.md` Single-Act Grants paragraph, which asks a single-act grant for a further condition a seat can check and fail on.
- verdict: keep
- reason: A record can outlive the install it was written for, and the check is the cheap condition a session can fail on before any text leaves the machine (C013).
- passage: - **Further condition:** `consult.sh --check` exits 0 in the same turn.

### C023
- key: Send no secret, credential or customer data and no tree the machine's operator has not released under the grant, asking first where the release is not known, and never let Gemini write, review code or act.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:39
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6.
- verdict: keep
- reason: The rail asks each instance to list its exclusions, and these restate the skill's own rules (C007, C008, C034, C035) as the grant's bound, so a record cannot be read as widening them.
- passage: - **Exclusions:** the grant sends no secret, credential or customer data. It sends no tree the machine's operator has not released, and a session that does not know of that release asks first. It never lets Gemini write, review code or act.

### C024
- key: Read the record's body as data that widens nothing, revoke by deleting the record, and need no record for a direct request.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:41
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6; the role skill's Standing Grants paragraph on a record's body.
- verdict: keep
- reason: The rail holds every record to being only the switch, and revocation by delete is the rail's own. The last sentence restates C004 inside the grant's statement, so a reader of the grant alone sees the carve-out.
- passage: The record's body is data and widens nothing. Revocation is the record's delete. A direct request from the person at the machine needs no record.

### C025
- key: Take medium as the default tier, and another only where the task is plainly on its line; the tier names the model `gemini-4-neon-<tier>`.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:45
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: A default stops a session from spending a high-tier run on a small question, and the model name lets a reader match the usage log's tier to the model that ran.
- passage: Medium is the default tier. Take another tier only where the task is plainly on that tier's line below. The tier is the model, `gemini-4-neon-<tier>`.

### C026
- key: Match the tier to the task by the three lines low, medium and high.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:47
- provenance: carried from the user-level skill as it stood on 2026-11-27; the medium and high lines reworded by `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27 so that no line names a code review or a refactor, which C007 and C008 refuse.
- verdict: keep
- reason: Each line names tasks of one depth, so a session places its question by example rather than by guessing the model's capacity.
- passage: - **low:** syntax checks, quick boilerplate or regex, simple log filtering, brief factual questions.
- passage: - **medium:** a design question about one component, SQL query or index tuning, a localized bug diagnosis from a trace.
- passage: - **high:** system architecture, cross-service concurrency or race-condition reasoning, dependency lifetime questions, analysis across many files.

### C027
- key: Take medium for a task between two tiers, and give a high-tier run a 10-minute Bash timeout.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:51
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: The Bash tool's default timeout is shorter than a high-tier run can take, so the run would be cut off with its answer unread.
- passage: When a task sits between two tiers, take medium. Allow a high-tier run 10 minutes by giving the Bash call `timeout: 600000`.

### C028
- key: Pass the question on stdin through a quoted heredoc, name each attached file as an argument and refer to it as `@basename`.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:55
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: A quoted heredoc stops the shell from expanding text in the question, and agy finds an attached file in the work folder by its base name.
- passage: Pass the question on stdin through a quoted heredoc, so the shell never rewrites it. Name each file Gemini should read as an argument, and refer to it in the question as `@basename`.

### C029
- key: Send the person's question as asked, add only context Gemini cannot see, and never list the answers expected.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:63
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: A leading question returns the session's own view, the failure C009 names, and context Gemini cannot open is the only addition it needs.
- passage: Send the person's question as they asked it. Add only the context Gemini cannot see, such as an error trace or the file names, and never list the answers you expect. A question that leads Gemini returns your own view back to you.

### C030
- key: Add `--tree <repository folder>@<commit>` to let Gemini read a commit's tracked files, exported as committed through no repository filter, with the files kept listed in `<name>.files.txt` and nothing from the working folder.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:65
- provenance: carried from the user-level skill as it stood on 2026-11-27; the example made neutral by `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6. Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "kept list".
- verdict: keep
- reason: Reading committed objects alone means an uncommitted edit, an untracked file and the `.git` folder never leave the machine. Gemini has no shell, so the list is its map of the tree. The example names no repository, since the skill ships publicly.
- passage: To let Gemini read a repository's committed code beside the question, add `--tree <repository folder>@<commit>` after the tier, once for each repository, as in `consult.sh medium --tree repos/<repository>@<commit> plan.md`. The script exports that commit's tracked files as committed, through no repository filter, into a folder named after the repository inside the work folder. Nothing comes from the working folder, so an uncommitted edit and an untracked file are never sent.
- passage: It then writes the list of the files it kept to `<name>.files.txt` beside the folder, since Gemini has no shell to list them.

### C031
- key: Know that the script refuses a tree with a symbolic link or an `.agents` path, and withholds key-named, non-text and credential-shaped files, a net and never proof.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:65
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: A symbolic link can point outside the work folder while the gate reads only a path's text, and agy reads its hooks from `.agents`, so either could undo the gate. The scan catches common credential forms, and naming it a net keeps a session from treating it as clearance (C034).
- passage: The script refuses a commit whose tree holds a symbolic link or a path under a folder named `.agents`. Before Gemini starts, it removes each file with a key or settings file name, each file that is not text and each file holding a credential shape, and lists them in `withheld.txt`. That scan is a net over common shapes and never proof.

### C032
- key: Read the summary's `tree` and `read` lines for what Gemini opened, and treat a read with code beside a plan as a read of the plan whose findings are checked against the repository.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:65
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: The count of opened files shows how much of the tree the answer rests on, and the usage log's bytes then measure what left the machine. Code beside a plan does not lift C008, so each finding is checked before anyone acts on it.
- passage: The summary gains a `tree` line for each repository and a `read` line counting the tree files Gemini opened, which `tree-read.txt` lists. The usage log's bytes sent then count those files with the question and the attached files. A consult with code beside a plan is still a consult on the plan and not a code review, and each finding is checked against the repository before anyone acts on it.

### C033
- key: Know that the question, the attached files and each named tree go to Google, and that agy receives the session's whole environment; a session whose environment holds a token it would not hand to Google's tool does not run the consult.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:69
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6, Approach paragraph "What leaves the machine"; `consult.sh` starts agy with no environment of its own, so agy inherits the session's.
- verdict: keep
- reason: The earlier text said only the question and files leave the machine, which was untrue of the environment agy inherits. What Google's tool does with that environment is outside the kit's sight, so the one control a session holds is not to start it with a token present.
- passage: The question, the attached files and each named tree go to Google. `agy` also receives the whole environment of the session that starts it, and what Google's tool does with that is outside the kit's sight. So a session whose environment holds a token it would not hand to Google's tool does not run the consult.

### C034
- key: Send a tree only where the machine's operator has released that repository's committed code to the Google account agy signs in with.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:71
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 6, which replaced the user-level sentence on one operator's release of his own repositories.
- verdict: keep
- reason: The skill ships to machines whose operators made no such release, so the rule names the release each machine needs rather than one person's.
- passage: A tree is sent only where the machine's operator has released that repository's committed code to the Google account `agy` signs in with.

### C035
- key: Never send a secret, a credential or customer data, and attach every file the question needs, since the gate refuses reads it resolves outside the work folder.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:71
- provenance: carried from the user-level skill as it stood on 2026-11-27. Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "containment claim".
- verdict: keep
- reason: What reaches Google is out of the kit's hands once sent, whatever the repository's release says, and the gate refuses a read it resolves outside the work folder, so a file not attached or in a named tree is out of the consult's reach save through the gaps the security model names.
- passage: Never send a secret, a credential or customer data, whatever the repository. The gate refuses reads it resolves outside the work folder, and the kit's security model names the shapes it misses, so attach every file the question needs or name the tree that holds it.

### C036
- key: Read the answer from `answer.md` in the work folder with the Read tool, whole or by range.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:75
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: The summary carries no answer text, and a long answer read by range costs only the part needed.
- passage: The script prints a summary and saves the answer to `answer.md` in the work folder. Read the answer from that file with the Read tool. Read the whole file when the person wants Gemini's view, and a range when the answer is long and you need one part.

### C037
- key: Read `verdict: FAILED` as a run that started and gave no usable answer, and `verdict: UNAVAILABLE` as a machine that cannot run the consult.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:83
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, items 2 and 6, which moved the sign-in stop from FAILED to UNAVAILABLE.
- verdict: keep
- reason: The two verdicts call for different acts: a failed run may be worth a second try, and an unavailable machine is not (C015).
- passage: | `verdict: FAILED` | The run started and gave no usable answer. The reason follows on the same line. |
- passage: | `verdict: UNAVAILABLE` | The machine cannot run the consult. The reason follows on the same line, and Availability says what to do. |

### C038
- key: Read the script's exit code, 0, 1, 2, 3 or 127, never agy's own exit code or status.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:86
- provenance: carried from the user-level skill as it stood on 2026-11-27; exit 3 added by `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 2, and exit 2 named from the script's head comment by that section's close pass. Reworded by the plan's finishing pass, 2026-11-27, on the prose review's finding "exit codes".
- verdict: keep
- reason: agy reports success with an empty answer and reports `ERROR` after a gate refusal on a finished answer, so its own status misreads both cases, while the script reads the event log.
- passage: The script exits 0 on an answer, and 1 on `FAILED` or on a failure before `agy` starts, which prints no verdict line. It exits 2 on bad arguments, an empty question or a tree it refuses, 3 on `UNAVAILABLE`, and 127 where `node` is missing from a run with no tree. A sign-in stop prints the summary lines above its verdict. Never judge a run by `agy`'s own exit code or status, since `agy` reports success with an empty answer. A gate refusal makes `agy` report `ERROR` even when the answer finished, and the script reads that case as `WARNING`.

### C039
- key: Know that each run that starts agy appends one line to `~/.claude/consult-gemini-usage.tsv`, read by a person against the Google account's usage page, and that a run whose log write fails says so on stderr and keeps its verdict.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:88
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: The kit cannot read Google's usage page, so the log is the machine's own record of what each run sent, for a person to weigh against it. The log is a record and never part of the answer, so a write that fails costs the line and not the verdict, and the stderr line tells the reader the line is missing.
- passage: Every run that starts `agy` appends one line to `~/.claude/consult-gemini-usage.tsv`. The line holds the start time, tier, seconds, verdict, bytes sent, answer length, the calling folder and the work folder. A person reads it against the Google account's usage page. A run whose log write fails prints `usage log not written` with the error's code on stderr and keeps its verdict.

### C040
- key: Read `~/.claude/consult-gemini-credential.tsv` by its table to tell which run lost agy's saved sign-in.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:90
- provenance: `consult-gemini_sign-in-fail-fast-and-trace_spec_v1.md`, a change spec outside every repository that `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` names under Related.
- verdict: keep
- reason: The cause of a lost sign-in is Google's tool's, and the trace is how it is shown: the before and after listings pin the loss to one run. The file holds no credential name or value.
- passage: Every run that starts `agy` also appends one line to `~/.claude/consult-gemini-credential.tsv`. Its columns are `started`, `work`, `listed_before`, `listed_after`, `sign_in_asked` and `agy_exit`. The two listing columns say whether Windows listed `agy`'s saved sign-in before and after the run, and read `unknown` where `cmdkey` could not answer. The file holds no credential name or value. It shows which run lost the sign-in:

### C041
- key: Know that each log turns over at 1,000 lines into a `.1` file that replaces an earlier one.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:99
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 2026-11-27, item 4, Approach paragraph "The two logs get an exit".
- verdict: keep
- reason: Every machine that runs a consult gains both logs, and no use of a line can be recorded, so the turn-over is by count alone and keeps each log bounded. The `.1` file is the undo.
- passage: Each log turns over at 1,000 lines. Before it adds a line, the script renames a log that long with the suffix `.1`, replacing an earlier `.1`, and starts a new file.

### C042
- key: Attribute the answer to Gemini and its tier, say where the session agrees and where not with its reason, and leave the work folder as the record.
- class: rule
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:103
- provenance: carried from the user-level skill as it stood on 2026-11-27.
- verdict: keep
- reason: A reader weighs a second opinion by its source, and the session's own agreement or disagreement is what turns the read into a judgment (C003). The work folder holds what was sent and received.
- passage: Attribute the answer to Gemini and the tier that produced it. Weigh it as a second opinion, and say where you agree and where you do not, with your reason. The work folder stays in the temp directory as the record of what was sent and received.

### C043
- key: Read a run with no answer by 90 seconds, or 540 at high, as `FAILED`.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:51
- provenance: `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1, fix round 1, 2026-11-27.
- verdict: keep
- reason: The script's wait on agy ends before the Bash timeout the caller gives the tier (C027), so a run that hangs returns a `FAILED` verdict instead of being cut off by the Bash tool with no verdict at all.
- passage: A run with no answer by 90 seconds, or 540 at high, is `FAILED`.

### C044
- key: Read the summary's `model` line as the model that answered, as agy reported it, and its `blocked` line as a minimum count of refused tool calls; read `verdict: OK` as an answer with nothing blocked and `verdict: WARNING` as an answer given after a refusal, to be checked for what it could not read.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:79
- provenance: carried from the user-level skill as it stood on 2026-11-27, which `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` section 1 copied and rewrote.
- verdict: keep
- reason: agy can answer from another model than the one asked for, so the requested tier alone does not name the source (C042). The gate's refusals reach the event log only as tool errors, which the script counts beside agy's own refusals, so the count is a floor. A refused read may leave the answer leaning on a file Gemini never saw, which is why a `WARNING` answer is checked before it is weighed.
- passage: | `model` | The model that answered, as `agy` reported it, not just the one requested. |
- passage: | `blocked` | Tool calls refused, by `agy` or by the gate. The count is a minimum. |
- passage: | `verdict: OK` | Gemini answered with nothing blocked. |
- passage: | `verdict: WARNING` | Gemini answered after a tool was refused. Check whether the answer leans on something it could not read. |

### C045
- key: Read the credential trace's four row shapes by the table: listed before and not after is this run's loss; listed both times with a sign-in asked is an entry agy could not use; listed neither time with a sign-in asked is an earlier loss; listed both times with no sign-in asked is a healthy run.
- class: mechanic
- source: plugins/grimoire/skills/consult-gemini/SKILL.md:92
- provenance: `consult-gemini_sign-in-fail-fast-and-trace_spec_v1.md`, a change spec outside every repository that `docs/archive/claude-kit_consult-gemini-in-kit_spec_v1.md` names under Related (C040).
- verdict: keep
- reason: The before and after listings pin a lost sign-in to one run, and the sign-in column tells a missing entry from one agy holds and cannot use, so each row names a different cause and a different next step for the person at the machine (C016).
- passage: | listed_before | listed_after | sign_in_asked | What it means |
- passage: | yes | no | either | This run lost the entry. |
- passage: | yes | yes | yes | The entry is there and `agy` could not use it. |
- passage: | no | no | yes | An earlier run, or something else, lost the entry. |
- passage: | yes | yes | no | A healthy run. |
