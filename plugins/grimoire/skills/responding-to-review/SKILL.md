---
name: responding-to-review
description: "Discipline for adjudicating review findings and feedback on their merits before acting on them. Use when a review agent returns findings, when the operator gives feedback or a correction, or before implementing a suggestion from either, especially when it seems wrong, unclear, or larger than the problem. Triggers: adversarial/blind/security/qa/docs review output to adjudicate, a 'you're right' about to be typed, pushback the session is tempted to swallow."
---

# Responding to Review

## Two Sources

**Review-agent findings**, from any lens, are input to your judgment, not orders. A finding can be wrong, out of scope, or built on context the agent lacked. Adjudicate each with an honest verdict, never a rubber stamp or reflexive deference, and push back on a wrong one with the reason.

Executing-work's step 4 routes each finding, its trace and provenance read before its severity, claim findings included. Finishing-work's step 5 routes the docs-curator's Drift Report.

**My feedback** is trusted: implement once you understand it. Still verify scope when it is unclear, and still say so when you see a problem with it.

## How to Respond

1. **Verify against the code, not the claim.** Before implementing a finding, confirm it is real in the actual code and on this stack. A finding of an absence is a scope claim first: re-read the spec section before you design the fix, and send an absence outside what the section asked for to executing-work's out-of-scope route at its step 4. Grep for a pushed-for abstraction's caller, per the doctrine's write-the-minimum rule, and leave it out where none exists.
2. **Push back with the reason, up front.** The doctrine's "Disagree up front" bullet governs. If you pushed back and were wrong, say so plainly and implement, with no defense.
3. **Triage and record.** Critical, Major, Minor are handled exactly as executing-work's "Address findings" step defines. This skill governs how you weigh and answer a finding before that triage.
4. **No performative agreement.** Per the doctrine's no-flattery and skip-the-preamble bullets, a review reply carries no "Good catch", no "You're absolutely right", and no thanks for the finding. State the fix or the disagreement.

## Corroboration Outranks Severity

When two lenses with no contact land on the same defect, weight that convergence above either finding's severity when you order the fixes. So a corroborated Major goes ahead of a lone Critical, which still gets step 1's verification.

Lenses sharing an input make one observation reported twice: one lens, a reviewer handed another's output, a shared framing, or shared standing-brief content, even content executing-work's contamination test clears. Check what each lens was given before you count two.

Two lenses landing on one defect in an artifact this effort wrote corroborate. Two citing it as evidence of a fact the effort does not own, such as a contract or a tool's output, are one finding, and that fact needs evidence from outside the effort. Fixtures, stubs, golden files, sample payloads, and generated files are instances rather than the boundary: the class is any artifact this effort authored, cited as evidence of a fact the effort does not own. An artifact predating the effort counts toward independence, and merge state is not the test.

A claim about a contract cites its owning surface, such as the schema or the tool source line that emits the output, which outranks any artifact exercising it. Those surfaces are instances rather than the boundary: the owning surface is wherever the fact's own producer defines it, never a copy that restates it. Where none states it, the contract is unstated and the asserting artifact a proposal.

## Reviewer Clearances

A reviewer's explicit clearance ("this line is fine", "no finding on X") is a claim about the code, not a fact you inherit. A load-bearing one owes step 1's verification before the section closes on it, never adoption on the agent's word. A clearance is load-bearing when believing it retires a check you would otherwise run, such as that model-writable input cannot reach the sink. A bare `APPROVED` verdict retires no specific check, so it does not put you back in the diff.

When two lenses contradict on one passage, adopt neither verdict. For what the code does, trace it yourself and record the evidence, such as the file:line, not the verdict you sided with. For whether it does what was asked, read the spec section's own words and record that reading. Neither severity nor specialty breaks the tie, and a lens denied the relevant input rules only on what it held.
