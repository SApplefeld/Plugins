---
name: design-council
description: "Convenes a read-only, multi-lens design council to pressure-test competing approaches at a genuine architecture fork. Use when the brainstorming skill offers it because a decision is material and hard to reverse - architecture, schema/data-model, build-vs-buy, a migration direction - and directly when the operator asks to 'convene the council', 'pressure-test this approach', or 'get multiple angles on this design' before building. Not for reviewing written code (use adversarial-reviewer), non-code judgment calls, or a session stuck mid-execution (use the consult, whose one seat rules where the council informs the operator at design time)."
---

# Design Council

## Roles

- **Orchestrator** - this session. It frames the fork, dispatches agents, carries text between rounds, and presents the result to me. The orchestrator does not judge convergence and is not a council member.
- **Council members** - read-only `council-member` agents, one per lens. They research the real repo and data, take positions, and engage each other across rounds.
- **Facilitator** - one read-only `design-facilitator` agent, neutral, separate from the orchestrator.

## 1. Frame

State the decision as an **outcome**, what is true when done, plus the 2–N candidate approaches. "Profile reads return under 50ms and skip the DB when cached" lets the council weigh caching against query optimization, while "add a Redis cache" pre-commits the argument. The default lenses are performance, maintainability/architecture, and risk-security, which reads `docs/security-model.md` if present. Swap a lens to fit the fork, such as a data-model lens on a schema decision, or an opposite-approach steelman when one option is the obvious favorite. Name the cost to me as seats × round cap, and dispatch nothing before my yes.

## 2. Blind First Round

Dispatch each member separately and in parallel. Each brief carries verbatim the outcome, the approaches, that member's lens, and the repo paths and data worth reading. Members inherit nothing else, and they must not see each other's briefs or outputs this round.

## 3. Facilitator Pass

Hand the facilitator all member positions. It returns the agreement map, the attributed live disagreements, each one's crux, each agreed point classed as evidence-resolved or soft, and a status: CONVERGED, ANOTHER_ROUND with a targeted question per member, or DEADLOCK. Check a first-round CONVERGED is not just correlated models agreeing.

## 4. Cross-examination Rounds

On ANOTHER_ROUND, re-dispatch the named members. A re-dispatched member is a fresh agent handed the full transcript. Its brief carries its own prior position, the other positions, and the facilitator's question for it. It must engage the strongest objection aimed at it by conceding, rebutting with evidence, or revising, and report what it conceded versus held. Then run another facilitator pass. Stop on CONVERGED, on DEADLOCK, or at the round cap, default three.

## 5. Synthesis and Decision

Present the facilitator's synthesis: any converged recommendation with its evidence and trade-offs, and prominently any unresolved fork as my decision, with what each option optimizes for. If the council deadlocked or hit the cap, return "unresolved - standing positions follow" and show them, never forcing a consensus. Record my decision per the doctrine's Surface decisions in batches bullet. The council informs the call; it never makes it.
