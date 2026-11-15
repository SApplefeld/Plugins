# Rationale ledger: explainers

This file is the rationale ledger for the documents the `explainers` skill owns. Rule text says what happens; this ledger says why; git says when. Nobody loads it by default. A session about to change a rule in one of the documents below reads the entry for the claim it is changing first, so the reason a rule holds is not re-litigated at the next review.

Each document sits under its own heading, which opens with its inventory line (what the document is for, which moments it owns, and when a session loads it) and then carries one entry per claim, retired claims included so the next audit does not re-find them. An entry is keyed by the claim's imperative sentence and carries its class (rule, mechanic, pointer, or rationale-example), its source as file and line, its provenance (the commit, incident, plan doc, memory or kaizen note that installed it, or `no provenance found`), and its verdict (keep, rewrite, or retire) with the reason. A `C` entry's source line is read at the extraction commit `6bc07fb`; an `R` entry is a claim re-extracted from a hunk the Section 5 merge changed, and its source line is read at the merged commit `d9540ad`. Claim numbers restart under every document heading, and inside a document read in chunks they restart per chunk, so an entry id is unique only under its heading and a chunked document carries the chunk in the id (`c2.C001` is claim C001 of the second chunk); a claim named inside a reason or provenance line of such a document carries the same prefix. A `C` entry whose source hunk the Section 5 merge rewrote reads `retire` and carries a `superseded-by:` line naming the `R` entry that holds the passage at the merged commit; the passage's own verdict is that entry's, so a count of retirements over this ledger leaves those records out. A reason may name the form the judge ruled toward (a pointer at the owner, a split, a fold into a neighbour), because that form is why the verdict is rewrite rather than keep or retire; what a passage becomes is the rewrite plan's to decide, and where the two differ the rewrite plan governs. The target wording a judge proposed rides on the entry's `proposed:` line, one line per distinct proposal, on rewrite and retire entries that retire a passage; a proposal that pointed at another ruling by id carries the resolved text marked `(via Annn)`. A rewrite or retire entry whose passage a plan actually landed carries a `- landed: <commit> section <n>` line, where `<commit>` is the commit that landed the passage and `section <n>` counts the sections of the plan that commit belongs to, so the commit names the plan and the section number counts within it. A rewrite or retire the judge flagged as behavior-shaping carries `baseline-test: yes`, which is what the rewrite plan's RED and GREEN step keys on. What a passage becomes is the rewrite plan's to decide (`claude-kit_corpus-rewrite_spec_v1.md` under `docs/plans/`), and where it and a proposal differ the rewrite plan governs.

The rules below bind every entry written from now on. A `proposed:` line quotes the target text as it will read once landed: a constraint the proposal states is already met inside the quote, and a fragment kept from the next sentence is quoted as it reads after the deletion, since a quote that breaks its own line's constraint cannot be followed literally. A reason that rests on another passage, a duplicate that stays, a rule the other line carries, or the target of a pointer it orders, names that passage's entry id and is written against that entry's verdict, so two entries never each retire or defer to the other. A citation into another file names the target's own text, never a line number alone: an assertion's text for a test, a step's bold lead for a sibling skill, the number at most a convenience, since a line number rots under any edit above it. An entry carries a `passage:` line with the source text verbatim, which is what makes a keep re-read mechanical. A keep's `passage:` line carries exactly the kept text and no more, so it marks where the kept passage ends and at what grain, since a re-read anchored on whole sentences flags a clause whose semicolon-joined neighbour retired, and a keep spanning a rule and its rationale tail respells by construction under a list-form rewrite. A reason that relocates a clause names the destination line as part of the changed-line set the landing is checked against. The verdict governs: a keep's reason never authorizes a passage change, and where a reason orders more than its verdict, the verdict is the ruling. The three format rules (the `passage:` line, the cite by the target's own text and the marked passage end) bind entries written after they landed and are not backfilled into the entries this ledger already carries.

This pass's rules, ruled by the operator on 2026-09-25 and 2026-09-26 for the corpus-compression plan, bind every entry that pass touches. A keep verdict protects a claim's meaning and never its wording, so a kept claim may land in new words. An entry the drafter flagged carries one `flag:` line from a set closed at four: `weak-reason` where the reason names no artifact a reader can open, `stale` where the named artifact no longer says what the reason says, `unfounded` where the named artifact cannot be found, and `environment` where the claim would be false or meaningless on an install that is not the operator's own machine, tools or accounts. An entry the operator ruled carries `ruled: <keep|cut|amend|move> YYYY-MM-DD`, the set closed at those four. A ruled move lands the claim as a kit memory store record and retires the entry with a `superseded-by:` line naming the record and its tier.


## plugins/grimoire/skills/explainers/SKILL.md

This document is the session's part of an explainer video or a diagram made for the operator: a builder agent draws it, and the session checks the machine, writes the brief, dispatches the builder and reviews the result before the operator sees it. It owns what a plain request means, the preflight, who builds and at which dispatch table row, the draft exception, the storyboard rules, the narration's contents, the spellings and their read-back, the review, the delivery and the diagram route. Its load class is `named-trigger`: its description pulls it in on a request for an explainer video, a narrated or animated video showing how something works, or a diagram.

Written by `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 on 2026-11-14: whole document (the `C` entries below, whose passages are read at that section's tree). The plan's Intent records the frame, the operator's rulings and the alternatives it refused, and its Approach names the three homes the rules divide into.

### C001
- key: Load this skill when the operator asks for an explainer video, a narrated or animated video showing how something works, or a diagram, in plain words or as a rough draft or a sketch.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:3
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Goal names the plain request, the Opus builder and the review before the operator sees the result.
- verdict: keep
- reason: The description is what a plain request matches, and the Goal sets the bar at a request in plain words and nothing more, so the triggers name the plain forms and the draft words the draft rule keys on.
- passage: Use when the operator asks for an explainer video, a narrated or animated video showing how something works, or a diagram, in plain words or as a rough draft or a sketch.

### C002
- key: Split an explainer three ways: the session writes what it shows and says, a builder draws it, and the session reviews it; read the builder's part in its charter and the brief's shape in the form.
- class: pointer
- source: plugins/grimoire/skills/explainers/SKILL.md:8
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Approach names the three homes and what each must survive.
- verdict: keep
- reason: A rule lives in one of the three homes and the other two point at it, as the Approach states, so the skill names the charter and the form rather than restating them.
- passage: The session writes what an explainer must show and say, a builder agent draws it, and the session reviews it before the operator sees it. The `explainer-builder` charter holds the builder's part, and `references/builder-brief.md` is the form of the brief.

### C003
- key: Resolve `<plugin-root>` as the kit plugin root, two folders above this skill's folder.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:8
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The scripts sit under the plugin's `scripts/` folder, and a session loading the skill knows the skill's own folder, so the commands below resolve from it on any install.
- passage: Below, `<plugin-root>` is the kit plugin root, two folders above this skill's folder.

### C004
- key: Read a plain request for an explainer video as a drawn, narrated video whose screen keeps moving, never as narrated still slides.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:12
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Intent records the frame and the alternatives it refused.
- verdict: keep
- reason: A session's default for an explainer is narrated still slides, which the Intent's why chain names as the failure, and motion is what carries the explanation.
- passage: A plain request for an explainer video means a drawn, narrated video whose screen keeps moving, and never narrated still slides.

### C005
- key: Run the preflight first for a video.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:16
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Intent says a machine missing a piece stops with the piece named and makes no voice call.
- verdict: keep
- reason: A build on a machine missing a piece fails partway, after the narration has already gone to the outside service, so the check comes before any build.
- passage: For a video, run the preflight first:

### C006
- key: Run the preflight with `node <plugin-root>/scripts/explainer-preflight.js` and its three flags.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:19
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, quoting the usage line of `plugins/grimoire/scripts/explainer-preflight.js`.
- verdict: keep
- reason: The usage line is quoted from the script's header, the section's fact base, so the flags match the code.
- passage: node <plugin-root>/scripts/explainer-preflight.js [--browser <path>] [--ffmpeg <path>] [--settings <path>]

### C007
- key: Stop and name each missing piece where the preflight exits 1.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:22
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, from the preflight's exits in `plugins/grimoire/scripts/explainer-preflight.js`.
- verdict: keep
- reason: The preflight prints a line for each piece and exits 1 where any is missing and 2 for a refused argument, as its header states, and the Intent's done record stops such a machine with the piece named.
- passage: It prints a line for each piece, `found`, with a path where the piece has one, or `missing` with what to do. It exits 0 where every piece is found, 1 where any is missing, and 2 for a refused argument. On 1, stop and tell the operator each missing piece.

### C008
- key: Pass `--ffmpeg` or `--settings` where ffmpeg sits in a place the preflight does not know or the settings file is not at its default place, and give the builder the same path in the brief.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:24
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Approach finds each program from a closed list or an `--ffmpeg` flag naming an absolute path.
- verdict: keep
- reason: No script searches PATH and the settings file has one default place, so a program the list lacks or a moved settings file reaches the builder's scripts only by the flag, and the builder runs those scripts from the brief alone.
- passage: Where ffmpeg sits in a place the preflight does not know, or the settings file is not at its default place, pass its absolute path with `--ffmpeg` or `--settings`, and give the builder the same path in the brief.

### C009
- key: Run no preflight for a diagram.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:26
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: A diagram needs only the browser, and `render-html.js` exits 2 naming every path it tried where none is found.
- passage: A diagram needs no preflight, since `render-html.js` names a missing browser itself.

### C010
- key: Write the concept, the storyboard and the exact narration in the session, and dispatch `grimoire:explainer-builder` at dispatch table row "Explainer builder" on executing-work's `references/review.md` with the filled brief.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:30
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Goal names the plain request, the Opus builder and the review before the operator sees the result.
- verdict: keep
- reason: The dispatch table is the one place a dispatch's tier is stated, as the Approach says, so the skill points at the row and names no level, and it names the table's file, since a session acting from the skill alone cannot find the table otherwise.
- passage: The session writes the concept, the storyboard and the exact narration, and a builder builds. Dispatch `grimoire:explainer-builder` with the Agent tool at dispatch table row "Explainer builder" on executing-work's `references/review.md`, where a row gives the model and the effort, with the filled brief as its prompt.

### C011
- key: Never build on the session's own model, ask which model builds or offer a cheaper build.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:30
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Goal names the plain request, the Opus builder and the review before the operator sees the result.
- verdict: keep
- reason: The Goal refuses all three, and the charter pins the model, so each one spends attention or context on a settled question.
- passage: The session does not build on its own model, ask which model builds or offer a cheaper build.

### C012
- key: Build on Sonnet only where the operator's own words in the request ask for a rough draft or a sketch, at dispatch table row "Explainer draft" with that row's model passed.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:32
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, on the Opus-for-every-build recommendation the plan's Intent records as agreed.
- verdict: keep
- reason: A draft is the one build a smaller model makes, and only the request's own words can ask for it, so no session offers one.
- passage: A Sonnet build happens only where the operator's own words in the request ask for a rough draft or a sketch. Dispatch it at dispatch table row "Explainer draft", passing the model that row names.

### C013
- key: Name a draft `draft` in its file name and in the message that delivers it.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:32
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, on the draft label the plan's Intent records as agreed.
- verdict: keep
- reason: A draft that reads like the finished video would be judged as one.
- passage: A draft says `draft` in its file name and in the message that delivers it, so it never passes for the finished video.

### C014
- key: Make a new, empty build folder under the project's `.kit/scratch/` folder and fill the form there.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:36
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The charter limits the builder's writes to the build's folder, so the folder must exist and be named, and `.kit/scratch/` is the gitignored scratch path the doctrine gives transient artifacts, named whole so no reader takes a folder beside it under `.kit/`.
- passage: Make a new, empty build folder under the project's `.kit/scratch/` folder, and fill a copy of the form there.

### C015
- key: Open the storyboard on the watcher's own problem and close it by returning to that problem, solved.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:38
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: A watcher follows an explanation that answers a question already held, and the return shows the answer landed.
- passage: **The storyboard opens on the watcher's own problem and closes by returning to it, solved.** A watcher follows an answer to a question already held.

### C016
- key: Give one scene one idea under a title of a few words.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:39
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: Two ideas in one scene leave the watcher unsure which one the picture shows.
- passage: **One scene carries one idea, under a title of a few words.** Two ideas leave the watcher unsure which one the picture shows.

### C017
- key: Write the narration for the ear and to the watcher.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:40
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: Narration is heard once at speaking pace and never reread.
- passage: **The narration is written for the ear and to the watcher.** It is heard once and never reread.

### C018
- key: Write a picture note as what must be seen, naming what arrives, travels or changes, and never how it moves.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:41
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: What must be seen is the session's call, and the motion that shows it is the builder's design, so the note leaves the builder room to move things.
- passage: **A picture note says what must be seen and never how it moves.** It names what arrives, travels or changes, and the motion is the builder's design.

### C019
- key: Fix the invented names in the brief.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:42
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: A builder that invents its own names lets the picture and the narration call one thing two ways.
- passage: **The brief fixes the invented names.** The picture and the narration then call each made-up thing the same.

### C020
- key: Say in the last line and the last frame where a video shows something not built.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:43
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: A watcher who misses it takes a design for a working product, which the doctrine's nothing-untrue rule forbids.
- passage: **A video of something not built says so in its last line and its last frame.** A watcher who misses it takes a design for a product.

### C021
- key: Keep every customer's name, person's name and machine path out of the narration.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:45
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Section 1 sends the narration to the voice service and screens paths, web addresses and email addresses.
- verdict: keep
- reason: The narration leaves the machine, and the script's screen cannot tell a name from any other word, so the writer keeps names out.
- passage: The narration holds no customer's name, no person's name and no path from the machine.

### C022
- key: Take approved spellings from the operator-tier record `explainer-voice-spellings`, with `memq get explainer-voice-spellings --operator`.
- class: pointer
- source: plugins/grimoire/skills/explainers/SKILL.md:49
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Approach places the approved spellings in that record, on the operator's agreement the plan's Intent records.
- verdict: keep
- reason: The record keeps product names out of every kit file, so the skill names it and never copies it.
- passage: Approved spellings come from the operator-tier memory record `explainer-voice-spellings`, read with `memq get explainer-voice-spellings --operator`.

### C023
- key: Put each spelling a video needs in the brief, in both its forms.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:49
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, from the narration file's fields in `plugins/grimoire/scripts/explainer-voice.js`.
- verdict: keep
- reason: The record holds each name as shown and as sent, and the form's Spellings field places the shown form in a scene's `text` and the sent form in its `spoken`, so the skill names both forms and the form names their fields.
- passage: The brief carries each spelling the video needs, in both forms.

### C024
- key: Treat a name the record does not hold as new to the voice, and mark it new in the brief.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:49
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The builder reads the read-back for each new name, so the brief tells it which names those are.
- passage: A name the record does not hold is new to the voice, and the brief marks it new.

### C025
- key: Let the builder read the read-back listing for each new name, try another spelling where it was misheard, and report what it settled on.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:51
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Goal has every new name read back by a speech recognizer before the video reaches the operator's ear.
- verdict: keep
- reason: The narration script prints a line for each scene with the words the recognizer missed and added, and the builder is the one placed to try a spelling and run again.
- passage: The builder reads that line for each new name, tries another spelling where the name was misheard, and reports what it settled on.

### C026
- key: Read the final listing as the line the builder reports for each new name, against that scene's `heard` text in the build folder's `timeline.json`.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:51
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The missed and added listing is the narration script's printed output, which reaches the session through the builder's report, and `heard` is the recognizer's own text the timeline keeps, so the session checks the one against the other without a new call.
- passage: The session reads the final listing itself: the line the builder reports for each new name, against that scene's `heard` text in the build folder's `timeline.json`.

### C027
- key: Deliver no video whose timeline reads `not checked` for a scene holding a new name until the read-back has run, and tell the operator why it waits.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:53
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, from the narration script's exit 3 in `plugins/grimoire/scripts/explainer-voice.js`.
- verdict: keep
- reason: No session can hear, so the read-back is the one check a new name gets, and a re-run of the script sends a `not checked` scene to the recognizer again.
- passage: A video whose timeline reads `not checked` for a scene holding a new name is not delivered until the read-back has run, and the session tells the operator why it waits.

### C028
- key: Add a spelling to the record only on the operator's word, given after hearing it.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:55
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, on the operator's agreement to the spellings record the plan's Intent records.
- verdict: keep
- reason: A spelling the recognizer accepts can still sound wrong, and only the operator hears the result.
- passage: A spelling joins the record only on the operator's word, given after hearing it, since a spelling the recognizer accepts can still sound wrong.

### C029
- key: Review the build before the operator sees it: run the check with a sheets folder in the build folder and read every contact sheet.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:59
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Goal names the plain request, the Opus builder and the review before the operator sees the result.
- verdict: keep
- reason: The check is a floor that catches a frozen screen, and whether the motion means anything is the session's judgment on the sheets, as the Approach states.
- passage: The session reviews the build before the operator sees it. Run the check with a sheets folder in the build folder, and read every contact sheet:

### C030
- key: Run the check with `node <plugin-root>/scripts/explainer-check.js` and its four flags.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:62
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, quoting the usage line of `plugins/grimoire/scripts/explainer-check.js`.
- verdict: keep
- reason: The usage line is quoted from the script's header, so the flags match the code.
- passage: node <plugin-root>/scripts/explainer-check.js <video> [--max-mb <n>] [--still <seconds>] [--sheets <folder>] [--ffmpeg <path>]

### C031
- key: Send the builder each fault by name, and review again after its fix.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:65
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: A fault named by the check or the sheets is the builder's to fix, and a fix can break another scene.
- passage: Send the builder each fault by name, and review again after its fix.

### C032
- key: Treat two neighbouring frames on a sheet that show the same picture as a fault.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:67
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Out of Scope leaves a floor on changed area to the session's read of the sheets.
- verdict: keep
- reason: The check script catches only a frozen screen, so a picture that barely changes is caught by reading or not at all.
- passage: Two neighbouring frames on a sheet that show the same picture are a fault.

### C033
- key: Never let the builder's own check replace the session's review.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:69
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Goal names the plain request, the Opus builder and the review before the operator sees the result.
- verdict: keep
- reason: A builder grading its own work sees what it meant to draw.
- passage: A builder's own check does not replace this review, since a builder grading its own work sees what it meant.

### C034
- key: Deliver a file of at most 8 MB.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:73
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, on its assumption that 8 MB reaches the operator's phone.
- verdict: keep
- reason: The check's `--max-mb` defaults to 8, so a video that passes the default meets the bound.
- passage: The delivered file is at most 8 MB, the check's default bound, since a larger file may not reach the operator's phone.

### C035
- key: Name in the delivery message each name the operator's ear has not yet approved.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:73
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: No session can hear, so the operator is the first listener of a new name and needs to know which ones to listen for.
- passage: The message names each name the operator's ear has not yet approved, since no session can hear.

### C036
- key: Split a diagram as a video: the session writes what must be seen, and the builder, dispatched at dispatch table row "Explainer builder", or at "Explainer draft" only on the rough-draft words, draws one self-contained page, renders it and reads the image.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:77
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, on the diagrams the plan's Intent records the operator including, and its Opus-for-every-diagram recommendation recorded as agreed.
- verdict: keep
- reason: A diagram meets the same failures as a video, a session drawing on its own model and a build no one reviewed, so it takes the same split and the same two rows, the draft row on the same words a video's draft takes.
- passage: A diagram takes the same split. The session writes what must be seen. The builder is dispatched at dispatch table row "Explainer builder", or at "Explainer draft" only on the same rough-draft words, and draws one self-contained page, renders it and reads the image:

### C037
- key: Render a diagram with `node <plugin-root>/scripts/render-html.js` and its three flags.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:80
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, quoting the usage line of `plugins/grimoire/scripts/render-html.js`.
- verdict: keep
- reason: The usage line is quoted from the script's header, so the flags match the code.
- passage: node <plugin-root>/scripts/render-html.js <html path> <png path> [--width <n>] [--height <n>] [--browser <path>]

### C038
- key: Read the rendered image again before sending it.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:83
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The builder's reading grades its own work, and the doctrine's visual rule has the sender read the image before it is attached.
- passage: The session reads the image again before sending it, since the builder's reading grades its own work.

### C039
- key: Take the look from the operator-tier records `scott-diagram-style` and `scott-labels-title-case`, read with `memq get <name> --operator`, and put it in the brief.
- class: pointer
- source: plugins/grimoire/skills/explainers/SKILL.md:83
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The records hold the look and a client's name, so the skill names them and never copies them, and the builder reads the brief alone.
- passage: The look comes from the operator-tier records `scott-diagram-style` and `scott-labels-title-case`, which the session reads with `memq get <name> --operator` and puts in the brief.

### C040
- key: Read the settings file as the Channels broker's settings file, which names the voice key file and the voice.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:24
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Approach places the voice settings in that file.
- verdict: keep
- reason: The preflight and the `--settings` rule name the file, and a session that has never made a video has met it nowhere else.
- passage: The settings file is the Channels broker's settings file, which names the voice key file and the voice.

### C041
- key: Put the absolute path of `<plugin-root>` in the form's Kit Root field.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:36
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The charter runs every script as `<kit root>/scripts/<script>` and stops where the brief names no root, so the session fills the field with the root it resolved above.
- passage: Put the absolute path of `<plugin-root>` in the form's Kit Root field, since the builder runs every script from it.

### C042
- key: Know the narration script as `explainer-voice.js`, which sends each scene to an outside voice service, has its recognizer read the audio back, and refuses a path but not a name.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:45
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Section 1 sends the narration to the voice service and screens paths, web addresses and email addresses.
- verdict: keep
- reason: The rule keeping names and paths out of the narration (C021) rests on where the narration goes and on what the script's screen can catch, and the read-back rules below name the recognizer.
- passage: The narration script, `explainer-voice.js`, sends each scene to an outside voice service and has that service's recognizer read the audio back. It refuses a path but cannot tell which words are names.

### C043
- key: Where the spellings record is not found, every name is new and goes as written, and the delivery message says so.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:49
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, whose Assumptions state this as the reversal of the assumption that every machine reads the operator tier.
- verdict: keep
- reason: With no record no spelling is approved, so every name takes the read-back a new name takes, the operator is the first to hear each one, and the message says why none was settled.
- passage: Where the command finds no record, every name is new and goes as written, and the delivery message says so.

### C044
- key: Send the builder back to re-run the narration script for a scene whose timeline reads `not checked`.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:53
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, from the narration script's exit 3 in `plugins/grimoire/scripts/explainer-voice.js`.
- verdict: keep
- reason: The builder runs the scripts, and a re-run sends a scene whose heard text reads `not checked` to the recognizer again while keeping its audio, as the script's header states (C027).
- passage: The session sends the builder back to re-run the narration script, which reads that scene back again.

### C045
- key: Send a file over the bound back to the builder to be made smaller, and never send it.
- class: rule
- source: plugins/grimoire/skills/explainers/SKILL.md:73
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, on its assumption that 8 MB reaches the operator's phone.
- verdict: keep
- reason: A file over the bound may not reach the operator's phone (C034), and the builder owns the encode that sets its size.
- passage: A file over the bound goes back to the builder to be made smaller, never sent.

### C046
- key: Attach the video to the channel message through the reply tool's file argument.
- class: mechanic
- source: plugins/grimoire/skills/explainers/SKILL.md:73
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The operator watches on the phone the channel reaches, and how a diagram's image goes out over the channel stays with the doctrine's visual rule, which the ownership map's rendered-visual row names.
- passage: The video goes attached to the channel message, by the reply tool's file argument.

## plugins/grimoire/skills/explainers/references/builder-brief.md

This document is the blank form of the brief the explainers skill fills for each build and hands to the `explainer-builder` agent as its prompt. It owns the brief's fields: the goal, the deliverable, the paths the session passed to the preflight, the invented names, the settled spellings, the look, one scene's three parts and the report's items. Its load class is `named-trigger`: the skill's Writing the Brief section names it when a session fills a brief.

Written by `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 on 2026-11-14: whole document (the `C` entries below, whose passages are read at that section's tree).

### C001
- key: Fill one copy of the form per build in the build folder, and hand it to the builder as its prompt.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:3
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The builder starts with no session context, so the filled form is the whole of what it knows, and one copy per build keeps two builds from sharing one.
- passage: Fill one copy per build in the build folder, and hand it to the builder as its prompt.

### C002
- key: Write `none` in a field with nothing to say.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:3
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: An empty field reads as one the session forgot, and `none` says it was weighed.
- passage: A field with nothing to say reads `none`.

### C003
- key: State the goal as what the watcher understands at the end, in one sentence.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:7
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The goal is what the builder judges each scene against.
- passage: What the watcher understands at the end, in one sentence.

### C004
- key: Name the deliverable, the build folder and the output file name, with `draft` in it for a draft.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:11
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The skill's draft rule puts `draft` in a draft's file name, and the builder writes only in the build folder.
- passage: `video` or `diagram`, the build folder, and the output file name, with `draft` in it for a draft.

### C005
- key: Give each absolute path the session passed to the preflight with a flag, never a path the preflight printed, and for a diagram the browser only where `render-html.js` named a missing browser and the session found one.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:19
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14, rewritten at the finishing pass 2026-11-15 on the final prose and adversarial reviews, since a printed path can be shortened to `~`.
- verdict: keep
- reason: No script searches PATH, so a program in a place the lists lack reaches the builder's commands only through these paths; the preflight prints a path under the home folder shortened to `~`, which `--browser` and `--ffmpeg` refuse and a settings read does not find, so only the session's own absolute path is handed on; a settings file at its default place needs no `--settings`, so the builder is handed the path to the file that names the key only where it must pass it; and a diagram runs no preflight.
- passage: Each absolute path the session passed to the preflight with `--browser`, `--ffmpeg` or `--settings`, never a path it printed. For a diagram, the browser only where `render-html.js` named a missing browser and the session found one.

### C006
- key: Write each invented name once, as the picture and the narration both spell it.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:23
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The skill's storyboard rule has the brief fix the invented names.
- passage: Each made-up name the build uses, written once, as the picture and the narration both spell it.

### C007
- key: Give each settled spelling in its two forms, and mark each name new to the voice.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:27
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The narration file takes the shown form in `text` and the sent form in `spoken`, and the builder reads the read-back for the names marked new.
- passage: Each settled spelling, the shown form for a scene's `text` and the sent form for its `spoken`. Each name new to the voice, marked `new`.

### C008
- key: Give the look from the operator-tier style records.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:31
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The skill's diagram rule puts the look in the brief, and the builder reads no record itself.
- passage: The look from the operator-tier style records.

### C009
- key: Write one block for each scene, in order, with its title, its exact narration and its picture note.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:35
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: A scene's three parts are what the builder turns into one audio file and one stretch of picture.
- passage: One block for each scene, in order: - Title: a few words. - Narration: the exact words spoken. - Picture note: what must be seen, naming what arrives, travels or changes.

### C010
- key: Give a diagram one picture note and no narration.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:41
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: A diagram is one image with no voice.
- passage: A diagram has one picture note and no narration.

### C011
- key: Ask for the report's items: the file and image paths, the check's output and sheet paths, each scene's start, each settled spelling, the capture method and `not checked` for each check not run.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:45
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: These are what the session's review reads, and the charter has the builder report them.
- passage: Return: - The file's path, and for a diagram the rendered image's path. - The check's output and each contact sheet's path. - Each scene's start against its narration's start. - Each settled spelling with its last read-back line. - The capture method, with its reason where it is not the kit's script. - `not checked` for each check not run.

### C012
- key: Give the kit plugin root as an absolute path.
- class: mechanic
- source: plugins/grimoire/skills/explainers/references/builder-brief.md:15
- provenance: `docs/plans/claude-kit_explainer-videos-and-diagrams_spec_v1.md` section 3 2026-11-14.
- verdict: keep
- reason: The charter runs every script as `<kit root>/scripts/<script>`, the placeholder this field fills, and stops where the brief names no root.
- passage: The kit plugin root, as an absolute path.
