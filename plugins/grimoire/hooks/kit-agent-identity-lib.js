// Shared predicate: does a hook payload belong to a subagent's tool call?
//
// A subagent's payload carries the PARENT session's `session_id`, byte for byte,
// so no session-id test can tell one from a main-thread call. The agent-identity
// keys can, and every hook that must not act inside a subagent asks the same
// question of the same five spellings. The breadth is the point: the cost of
// reading one key too many is a main-session call misread as a subagent's on a
// harness that never sends it, and the cost of reading one too few is a whole
// class of subagent calls invisible to every detector at once.
//
// This is its own module, holding that question, the caller's type the two
// payload guards read, and the policy class of an agent type, and nothing else,
// for the reason
// hooks/kit-network-lib.js states for its own predicate: a hot hook path cannot
// pay a large module's load to answer one question, and a hook that reached into
// a sibling hook for the answer would be taken down silently by any failure
// inside that sibling. Four hooks ask this question on a per-tool-call boundary
// and two guards ask the type question beside it, and one hand-copied set that
// gains a spelling at some sites and not others is a leak nothing detects: the
// sites that kept the old set simply keep answering.
//
// FIVE READINGS, because the call sites genuinely need five and this module
// exists to unify the key set rather than to flatten behaviour that differs on
// purpose:
//
//   agentIdentity      the first truthy value, or null. The caller that wants
//                      to know WHICH identity it saw.
//   isSubagentCall     the same reading as a boolean.
//   carriesAgentKey    presence rather than truthiness, for the caller whose
//                      stand-down is deliberately the wider one.
//   dispatchedAgentId  the agent id alone, as a string, deliberately narrower
//                      than all three. `agent_type` rides on the MAIN thread of
//                      a session started with --agent, so a boundary that stood
//                      down on the wider reading would be dead from that
//                      session's first prompt onward with nothing reporting it.
//                      An agent id is the one key present when and only when the
//                      payload belongs to a dispatched agent.
//
//                      It reads ONE spelling, `agent_id`, and the breadth this
//                      module exists for is dropped here on purpose rather than
//                      omitted. The CLI's payload schema documents `agent_id` as
//                      the key absent on the main thread even in an --agent
//                      session, which is precisely the distinction being drawn,
//                      so a second spelling folded in would have to carry that
//                      same property to be an answer to the same question, and a
//                      type spelling does not. Where the key set above is broad
//                      because a missed spelling costs a whole class of
//                      subagent calls, a wrong spelling here costs the feature
//                      the caller is standing down from.
//   agentTypeOf        the trimmed type string under the first
//                      AGENT_TYPE_KEYS spelling holding one, or null. The two
//                      guards that judge a tool call by the calling agent's
//                      type read it here.
//
// TWO KEY LISTS, because identity and subject are two questions. AGENT_KEYS
// answers "was this payload produced by an agent", which is what an id or a type
// spelling on it says. AGENT_TYPE_KEYS answers "what type of agent is this
// payload about", which is the dispatch subject a recognition trigger is matched
// against: it drops `agent_id`, an instance rather than a type, and carries the
// bare `type` a dispatch payload may spell. The two payload guards read the same
// list off a tool call's own payload, where the type names the agent making the
// call, so a caller whose type rides under any of its spellings is judged.
//
// Truthiness is the reading most callers take. A harness emitting a null or
// empty `agent_id` on every main-session payload would otherwise stand those
// hooks down on every call and retire their features outright, which is a
// failure nothing would report; presence is the stricter reading, and a caller
// takes it when standing down too often is the cheaper of its two errors.
//
// A non-object answers "no identity" rather than throwing: every caller here
// runs inside a hook that must never disturb the session it observes, and each
// one screens the payload's shape on its own account before it gets this far.

'use strict';

const AGENT_KEYS = ['agent_id', 'agent_type', 'agentType', 'subagent_type', 'subagentType'];

// The spellings a payload names an agent TYPE under, read where the type is the
// subject: the input of a dispatch call, and the payload of the dispatch event
// itself. The two payload guards also read it, through agentTypeOf, off a tool
// call's payload to learn the calling agent's type. The breadth is AGENT_KEYS'
// own, for its reason: a harness spelling the field one way this list does not
// carry is a whole class of dispatch invisible to every reader at once.
const AGENT_TYPE_KEYS = ['subagent_type', 'subagentType', 'agent_type', 'agentType', 'type'];

// The trimmed string under the first AGENT_TYPE_KEYS spelling a payload holds a
// non-empty string on, or null for a non-object payload or one where no
// spelling holds such a value. An earlier spelling that is absent, not a
// string, or empty after trimming falls through to the next rather than
// standing the caller down: the two guards that judge a subagent's payload by
// its type need the type wherever the harness put it, not only under the
// first spelling it happens to try.
function agentTypeOf(payload) {
    if (payload === null || typeof payload !== 'object') return null;
    for (const key of AGENT_TYPE_KEYS) {
        const v = payload[key];
        if (typeof v === 'string') {
            const t = v.trim();
            if (t) return t;
        }
    }
    return null;
}

function agentIdentity(payload) {
    if (payload === null || typeof payload !== 'object') return null;
    for (const key of AGENT_KEYS) {
        if (payload[key]) return payload[key];
    }
    return null;
}

function isSubagentCall(payload) {
    return agentIdentity(payload) !== null;
}

function carriesAgentKey(payload) {
    if (payload === null || typeof payload !== 'object') return false;
    for (const key of AGENT_KEYS) {
        if (key in payload) return true;
    }
    return false;
}

// The agent id a payload carries, or ''. Read off the one key rather than the
// whole set, and never folding in a type spelling: a type is a subject, and a
// caller asking this question is asking whose context the payload belongs to.
function dispatchedAgentId(payload) {
    if (payload === null || typeof payload !== 'object') return '';
    const id = payload.agent_id;
    return (typeof id === 'string' && id !== '') ? id : '';
}

// The policy class of an agent type: 'strict' for the read-only judgment seats,
// 'gate' for the QA verifier, and null for every type nothing governs
// (implementers, docs-curator, general-purpose, Explore, the bare "claude" a
// background job's main session presents, and any unknown type). Matched by
// suffix so a plugin-namespaced id ("grimoire:blind-reviewer") resolves, and
// anchored at the end so a longer name that merely contains one
// ("blind-reviewer-helper") does not.
//
// It lives beside the identity readings above for their reason rather than
// because it answers the same question: two hooks classify a type on a
// per-tool-call boundary, the guard that refuses a read-only seat's
// tree-mutating command and the recognition nudge that stands down rather than
// injecting store text into a seat dispatched to hold a context that inherited
// nothing, and a hand-copied list that gains a seat in one place and not the
// other leaks silently, the copy that kept the old list simply continuing to
// answer.
function reviewAgentClass(type) {
    if (typeof type !== 'string' || type === '') return null;
    if (/(^|[:/])qa-verifier$/i.test(type)) return 'gate';
    if (/(^|[:/])(?:adversarial-reviewer|blind-reviewer|security-reviewer|performance-reviewer|council-member|design-facilitator|consultant|blind-reader|prose-reviewer|plan-reviewer|corpus-drafter|scope-adjudicator)$/i.test(type)) return 'strict';
    return null;
}

module.exports = {
    AGENT_KEYS,
    AGENT_TYPE_KEYS,
    agentTypeOf,
    agentIdentity,
    isSubagentCall,
    carriesAgentKey,
    dispatchedAgentId,
    reviewAgentClass
};
