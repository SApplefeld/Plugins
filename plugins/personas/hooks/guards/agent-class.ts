// agent-class.ts: the policy class of an agent type, which the before-tool
// guards key on. It is the kit's reviewAgentClass (kit-agent-identity-lib.js)
// ported whole: the read-only judgment seats are `strict`, the QA verifier is
// `gate`, and every other type, the main session's absent type included, is
// governed by nothing.
//
// Nothing here reads `$` (runner.ts says why).

// The read-only judgment seats, matched by suffix so a plugin-namespaced id
// ("grimoire:blind-reviewer") resolves, and anchored at the end so a longer
// name that merely contains one ("blind-reviewer-helper") does not.
export const STRICT_SEAT = /(^|[:/])(?:adversarial-reviewer|blind-reviewer|security-reviewer|performance-reviewer|council-member|design-facilitator|consultant|blind-reader|prose-reviewer|plan-reviewer|corpus-drafter|scope-adjudicator)$/i;

// The QA verifier, which builds and runs the suites, matched as the seats are.
export const GATE_SEAT = /(^|[:/])qa-verifier$/i;

export type AgentClass = "strict" | "gate";

/**
 * The policy class of an agent type: `strict` for the read-only judgment
 * seats, `gate` for the QA verifier, and null for every type nothing governs
 * (implementers, docs-curator, general-purpose, Explore, the bare "claude" a
 * background job's main session presents, any unknown type, and no type).
 */
export function reviewAgentClass(type: unknown): AgentClass | null {
  if (typeof type !== "string" || type === "") return null;
  if (GATE_SEAT.test(type)) return "gate";
  if (STRICT_SEAT.test(type)) return "strict";
  return null;
}
