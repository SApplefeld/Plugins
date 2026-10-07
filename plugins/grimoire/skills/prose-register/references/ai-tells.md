# Machine-Prose Tells

Patterns that make a document read as machine-written. A writer avoids them before finishing a draft; a reviewer hunts them by name and quotes the passage, whatever the voice.

None is wrong alone. What marks the prose is the pattern held without variation: one triad is a sentence, a triad in every paragraph is a signature. A finding is usually about frequency and uniformity rather than one line, and it says which it is.

## Banned Outright

Each item here is a finding on one instance rather than on frequency.

- Rhetorical questions in body prose, an opening on a question, and a question-form heading other than a table's column headings. The one licensed form is the self-answer device (`"The answer to solve this? Impersonation."`), at most once per document.
- Motivational vocabulary: "unlock", "leverage", "empower", "transform", "revolutionize", "game-changer", "world-class" and "cutting-edge" among them.
- Hype adjectives and weightless intensifiers unsupported by a figure: `truly`, `really`, `incredibly`, `highly`, `vital`, `essential`, `powerful` and `significantly` among them.
- "In conclusion" and "To summarize" signposting on a closing section. The final section states the result.
- Em dashes, which the doctrine's Style bullet owns.
- Hedges stacked more than one deep on a single claim. One hedge claims confidence, and a stack claims nothing.

## Pattern Catalog

### Triadic Rhythm by Default

Three-item lists and three-clause sentences are the machine's resting cadence. Human enumeration is lumpy.

Tell: "The service is fast, reliable, and secure. It handles authentication, authorization, and auditing across the web, mobile, and API surfaces."

Rewrite: "The service handles authentication and authorization. It also writes an audit record for every call, which is the part that matters when a customer disputes a charge."

The rewrite drops one item, keeps two, and spends the saved words on why the second earns its place. A real three-member set takes three. The finding is a document where nearly every set has three.

### Negation-Then-Correction Framing

"It is not X, it is Y" stages a reversal against a view no reader proposed.

Tell: "This is not a configuration change. It is a change to how the system thinks about identity."

Rewrite: "The change moves identity resolution out of the config file and into the token itself."

The `However,` pivot `voice-scott.md` licenses is different: it argues against a position a real reader holds. The tell argues against a straw position invented one clause earlier.

### Uniform Paragraph and Sentence Length

Every paragraph three sentences, every sentence the same length. To measure the tell, take a section's sentence lengths and read the spread. Sentences all within a few words of each other read as generated. Three 23-word sentences in a row, paragraph after paragraph, is the tell.

### Bold Lead-In on Every Bullet

Every bullet opens on a **Bold term:** lead, argument bullets included, so the list reads as labels. The doctrine's rule-then-reason bullet owns the rule and its bound.

### Signposting and Throat-Clearing

"It is worth noting that", "importantly", "in essence", "at its core", "simply put", "that said". Each spends a clause telling the reader how to receive the next. The test is to cut it: if the sentence is unchanged, it was throat-clearing. The hand-holding forms on a close, "Remember:" and "The takeaway is:", are the same tell and fail the same test.

Tell: "It is worth noting that the migration is reversible."

Rewrite: "The migration is reversible."

A contrast marker with an antecedent, such as `However,`, survives the test, because removing it changes the logical relation.

### Structural Previews

A paragraph previewing the structure of the section that follows, which the reader can see. Delete it and open on the section's thesis. An early scope statement of what the piece will and will not cover is licensed, since it draws a boundary. The tell is the preview repeated at the head of every section.

### Restating Close

A closing summary whose every sentence appeared earlier in different words.

The end-state close in `voice-scott.md` is the opposite move: it states what the reader now has after applying the design. That is new information the body arrived at, not repeated from it.

Tell: "In summary, the design separates the two roles, restricts the permissions on each, and audits the boundary between them."

Rewrite: "The result is an operator who can run every report and cannot read a single card number."

### One-Line Moral Endings

An aphoristic sentence, set off alone, telling the reader what the section meant. Once is emphasis. At the foot of every section it is a template.

Tell: a section on retry policy that ends "Resilience is not a feature you add later." A section on logging that ends "You cannot fix what you cannot see."

Rewrite: end on the concrete consequence instead. "A request that fails all three retries lands in the dead-letter queue with the original payload intact."

### Generated Vocabulary

These words read as generated: `delve`, `robust`, `seamless`, `comprehensive`, `streamline`, `crucial`, `landscape` (figurative), `realm`, `myriad`, `testament to`, `navigate` (figurative), `in today's [adjective] world`, and `ensure` where a plain verb would do.

Tell: "In today's fast-moving compliance landscape, a comprehensive audit trail is crucial to ensuring seamless reporting."

Rewrite: "An auditor who asks who approved a refund on 14 March needs one query to answer it. The audit trail is what makes that query possible."

They are not banned: `robust` in statistics and `ensure` in a contract clause are right. The finding is density and figurative use. Swapping the word fixes nothing. The rewrite works because it adds a fact.

### Over-Parallel Headers

Headers built from one template, such as five sections all reading "Understanding X" or all gerunds. Forcing one shape bends a section to fit its label.

A header set can pass the doctrine's heading bullet and the case `voice-scott.md` sets and still be this tell. A standard name reused for a recurring section across pieces, such as "Test Coverage", is never this tell.

### Trailing Participial Clauses

The comma-plus-participle tail: ", ensuring that", ", allowing teams to", ", making it easy to", ", providing a foundation for". It appends a benefit to a fact without arguing for it, and it stacks without limit.

Tell: "The gateway caches the token, reducing round trips and allowing downstream services to authorize locally, ensuring consistent latency."

Rewrite: "The gateway caches the token. Downstream services authorize against the cached copy, which removes a network hop from every call after the first."

One tail in a document is fine. Three in a paragraph is the pattern.

### Non-Committal Verdict

A close that lists options, gives each a merit, and declines to pick. The doctrine's answer-first and fork bullets own the rule.

### Bullets Restating the Paragraph

A bullet list right after a prose paragraph repeats its points as fragments. It looks like structure and carries nothing new. Keep whichever carries the detail, such as a list of dates and owners the paragraph never had. Where the list would only re-say the paragraph, cut it.
