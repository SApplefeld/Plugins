---
name: prose-register
description: "The register every piece of prose takes, with its scaling by piece, its voice layer and a catalog of machine-prose tells. Use when writing or reviewing any prose for a reader beyond a single passage: a deliverable document, an article, a ticket, an email and a pull request body are among the instances. Use also for any piece that names a voice."
---

# Prose Register

This skill holds the recipe, the scaling, the voice layer, the tells catalog, the plan brief and the changelog entry. The rule is the doctrine's, the sentence bars are `writing-skills`' "What a Sentence Must Earn" section, and the review procedure is the `prose-reviewer` charter's.

## Recipe

Each item gives a doctrine bullet's writer move and reviewer check.

- **The answer comes first, at every scale.** The writer reads the last sentence of the piece and of each section, paragraph and bullet, and moves a point found there to the front. The reviewer reads first sentences alone, and one missing its unit's point is a finding. Marketing copy takes the override only by declaring itself so in one sentence on the piece. The reviewer then withholds this bullet alone.
- **Structure follows what the reader will look for, never the word count.** A heading is never a question or an instruction. The reviewer reads the headings alone as a table of contents, and a heading naming nothing a reader looks up is a finding.
- **A rule is stated, then its reason, as separate sentences.** The writer hunts each rule for a "because" or a "so that" riding inside it. Bold leads a reader would not scan are a finding, and so is a reason inside its rule.
- **A concrete case lands a passage and never leads one.** The reviewer hunts a leading case, a second case where one would do, an unmarked instance passing for the boundary, and a closed list whose class is open.
- **A claim is written in the form a reader can check.** The reviewer checks claims from the piece alone, and one needing a research pass is a finding.

## Scaling

Two readings set a piece's share: is it looked up, and does it carry an argument or a catalog?

- **Not looked up, an argument.** A passage, with plain leads.
- **Not looked up, a catalog.** A short list: a passage with a bold lead and its reason on each item.
- **Looked up, an argument.** A titled piece: a passage plus a title stating its point, and headings only where the heading bullet places them.
- **Looked up, a catalog.** A document: a titled piece plus every heading and column the heading bullet governs, and bold catalog leads.

The readings are made per piece and again per passage. The voice layer rides on any combination.

## Voice Layer

`Voice: scott` names `references/voice-scott.md`, the operator's voice, and every other `Voice:` value names no reference and takes the register alone. A voice reference admits only rules that change with whose name is on the piece, never a structure rule, a sentence rule or a tell. A new name's reference is a sibling file under `references/` under the same admission, added when a piece needs it.

## Tells Catalog

A writer reads `references/ai-tells.md`, the catalog of machine-written patterns the other rules leave standing, before finishing a draft. A reviewer hunts them by name and quotes the passage, whatever the voice. The catalog states each pattern's licensed form, or points at the licence's owner.

## Plan Brief

A plan brief is a projection of its plan document into seven labelled parts, never a fresh composition. The plan's Intent, Goal and Assumptions already hold what the brief says, and a second composition drifts from the first. Each part is a bold Title Case label ending in a period, then one or two sentences. The parts, in order, with the plan section each is drawn from:

- **Why It Opened.** The frame in `## Intent`.
- **The Pain.** The constraint the why chain in `## Intent` ends on.
- **Approach.** The first point of `## Approach`.
- **Solution.** The `## Goal` paragraph.
- **Good Enough.** What `## Intent` says done does and does not need.
- **It Assumes.** `## Assumptions` and the Chapters' `Assumptions:` lines.
- **Serves.** The `Serves:` line, the item's words or `None.`

A part whose source is empty or absent says so in its own sentence rather than borrowing from another part's source.

The first line is `# Brief: <plan title>`. The brief takes the doctrine's client-briefing register, addressed to the operator, with no `Voice:` layer, so every internal identifier is resolved to what it does. It is bounded to about 1,500 bytes by `wc -c`, since the operator reads it on a phone in place of the plan document. It lives at `docs/briefs/<plan stem>.md`, the stem being the plan file's name without `.md`, and moves to `docs/archive/briefs/` with its plan, as `curating-docs` states. `brainstorming` step 9 writes it at plan open, and `finishing-work` step 6 refreshes it from the closed plan. The decision brief, the dispatch brief and the kaizen brief are different artifacts: a question put to the operator, a subagent's instructions and the kaizen skill's note, none of them a plan brief.

## Changelog Entry

A changelog entry is a projection of a finished plan into a header and five labelled parts. It is addressed to a person who uses or checks the product and has read neither the plan nor the repository. Its first line is `# Change: <title>`. The title takes the doctrine's heading form in Title Case: it names the effect in a user's words, in two to five words, and takes no prefix, since `Product:` names the product. Four header lines follow, in this order, and a correcting entry adds a fifth, `Corrects:`:

- `Date:` the day the entry is drafted, as `YYYY-MM-DD`.
- `Product:` one of the product names the changelog folder's README lists.
- `Kind:` one of `new`, `changed`, `fixed`, `removed` and `withdrawn`.
- `Plan:` the plan's archived path, `docs/archive/<plan file name>`, or `none`.
- `Corrects:` the entry this one corrects, on a correcting entry only.

A `Corrected by:` line, where an entry gains one, is its last header line. Each part opens with a bold Title Case label ending in a period, at the start of its own line with no list marker before it, and its text follows on that line or on the lines under it. The parts, in order, with the plan section each is drawn from:

- **What Changed.** A list with one item for each change a user now sees or can do, from `## Goal` and the `Completed:` and `Decisions / Surprises:` lines of the Chapters the plan's sections closed. Each item opens with a bold label ending in a period, otherwise in the heading form, Title Case and five words at most, then one to three short full sentences.
- **Why.** One sentence, from the frame in `## Intent`.
- **By Design.** Behavior that may look like a defect and is intended, from what `## Intent` says done does not need, `## Out of Scope`, `## Assumptions`, and the Chapters' `Decisions / Surprises:` and `Assumptions:` lines. Sentences, or a list where the behaviors are separate.
- **What to Check.** A list of where to look and what to test again, one check to an item, from the Chapters the plan's sections closed.
- **Not Included.** A list of what the plan left out, from `## Out of Scope`.

The bullets above name the parts, and an entry writes no marker before a part's label. A part that holds one item may write it on the label's line. An entry reads as this one does:

```markdown
# Change: Invoice Exports Stay Consistent

Date: 2026-01-15
Product: Billing
Kind: fixed
Plan: docs/archive/billing_invoice-export-order_spec_v1.md

**What Changed.**
- **Exports Keep Column Order.** Every export of an invoice now lists its columns in the order the invoice screen shows. Two exports of one invoice match.
- **Empty Invoices Export.** An invoice with no lines now exports a file that holds the header row. It showed an error before.

**Why.** Two exports of one invoice came out with their columns in different orders.

**By Design.** None recorded.

**What to Check.**
- Export one invoice twice and compare the two files.
- Export an invoice that has no lines.

**Not Included.**
- Export to a spreadsheet file.
```

Where the plan document records no such behavior, By Design reads `None recorded.` and nothing is invented. An oddity the writer knows only from the code stays out, since the code does not say what was intended. An `## Out of Scope` item goes to one part. One that leaves behavior a user will meet looking broken or odd goes to By Design, and one that is a feature the plan did not build goes to Not Included.

The entry takes the doctrine's client-briefing register with no `Voice:` layer. No byte count bounds it: an item's three sentences are its limit, and a longer entry reports more changes. It names no customer, no person, no credential or internal host, and no detail of a security weakness beyond that one was fixed. No check measures this disclosure rule, so the writer holds it. An entry for work with no plan holds the header and the What Changed and What to Check parts. `curating-docs` states the folder an entry lives in, and `finishing-work` writes it at a plan's close.
