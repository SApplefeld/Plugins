// agent-class.ts: the policy class of an agent type, which the before-tool
// guards key on. Two classifications share the seat patterns. For the
// read-only guard, the read-only judgment seats are `strict`, the QA verifier
// is `gate`, and every other type, the main session's absent type included, is
// governed by nothing. For the shared-state guard, the implementer tiers are
// `mutating`, the QA verifier is again `gate`, and every other type is
// governed by nothing.
//
// Nothing here reads `$` (runner.ts says why).

// The read-only judgment seats, matched by suffix so a plugin-namespaced id
// ("grimoire:blind-reviewer") resolves, and anchored at the end so a longer
// name that merely contains one ("blind-reviewer-helper") does not.
export const STRICT_SEAT = /(^|[:/])(?:adversarial-reviewer|blind-reviewer|security-reviewer|performance-reviewer|council-member|design-facilitator|consultant|blind-reader|prose-reviewer|plan-reviewer|altitude-interviewer|corpus-drafter|scope-adjudicator|finding-verifier)$/i;

// The QA verifier, which builds and runs the suites, matched as the seats are.
export const GATE_SEAT = /(^|[:/])qa-verifier$/i;

// The implementer tiers, the seats that hold Bash and mutate the tree, matched
// as the seats are.
export const MUTATING_SEAT = /(^|[:/])implementer-(?:haiku|sonnet|opus|fable)$/i;

export type AgentClass = "strict" | "gate";

export type SharedStateAgentClass = "mutating" | "gate";

/**
 * The read-only guard's class of an agent type: `strict` for the read-only
 * judgment seats, `gate` for the QA verifier, and null for every type nothing
 * governs (implementers, docs-curator, general-purpose, Explore, the bare
 * "claude" a background job's main session presents, any unknown type, and no
 * type). An implementer tier stays null here: the read-only guard returns
 * early on null, and a class would run its gate-mode deny over every
 * implementer shell call.
 */
export function reviewAgentClass(type: unknown): AgentClass | null {
  if (typeof type !== "string" || type === "") return null;
  if (GATE_SEAT.test(type)) return "gate";
  if (STRICT_SEAT.test(type)) return "strict";
  return null;
}

/**
 * The shared-state guard's class of an agent type: `mutating` for the
 * implementer tiers, `gate` for the QA verifier, and null for every other
 * type, the read-only judgment seats included, since the read-only guard
 * already refuses them every state change.
 */
export function sharedStateAgentClass(type: unknown): SharedStateAgentClass | null {
  if (typeof type !== "string" || type === "") return null;
  if (GATE_SEAT.test(type)) return "gate";
  if (MUTATING_SEAT.test(type)) return "mutating";
  return null;
}
