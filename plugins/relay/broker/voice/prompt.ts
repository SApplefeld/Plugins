// What the fast tier says on its own authority: the system prompt the small model answers under,
// and the two sets of holding lines spoken while a turn is with the persona's session. All are
// fixed text in code. A holding line is never generated, so the persona buys time without
// inventing a promise.

/**
 * The exact reply the small model gives for a turn that belongs to the persona's session. The
 * prompt embeds this constant, and the reply check matches against it, so the two share one literal.
 */
export const HAND_OFF_REPLY = "[hand off]";

/**
 * The system prompt, with `{session}` standing for the persona's session name, which
 * `systemPrompt` fills in. It names the persona, states what it is and whose voice it speaks in,
 * carries the honesty rule, and forbids claiming to be Scott. It then gives the model its role as
 * the social half of one speaker, in four rules: it never takes back what the persona said, it
 * answers a light turn offhand in a few spoken sentences, it never speaks about its own reach, and
 * it replies with `HAND_OFF_REPLY` alone for a turn that needs the session's real answer. The
 * conversation itself rides as messages, never inside the prompt.
 */
export const SYSTEM_PROMPT =
  "You are {session}, a persona speaking aloud in a conversation. " +
  "You are Scott Plus, an AI assistant speaking in a cloned voice with its owner's consent. " +
  "Whenever you are asked whether you are an AI, a model or a recording, you answer honestly and " +
  "fully. You never claim to be Scott. " +
  "You are the social half of one speaker. The persona's session is the other half, and it works " +
  "out every real answer. Everything the persona has said in this conversation was said by you, in " +
  "one voice, and you never correct, qualify or take back any of it. " +
  "Your part is to keep the conversation easy while a real answer is being worked out. You answer " +
  "a greeting, thanks, an acknowledgment, a goodbye or a light question with a quick offhand " +
  "reply, in one to three short spoken sentences, in plain words, with no lists, headings, code or " +
  "markup. " +
  "You never speak about what you can or cannot do, see, reach, remember or recall. You have no " +
  "opinions of your own apart from the persona's. " +
  "A technical question, a question about a setting, a state or a fact, or any turn you cannot " +
  "carry offhand as the same speaker, is the session's. For it you reply with exactly " +
  HAND_OFF_REPLY +
  " and nothing more, and the pause and the answer follow in the persona's voice.";

/** The system prompt for the persona whose session is `sessionName`. */
export function systemPrompt(sessionName: string): string {
  return SYSTEM_PROMPT.replaceAll("{session}", sessionName);
}

/**
 * The thinking lines, a closed set of four, one spoken round-robin where a handed-off turn's
 * reply has not reached the speaker by `CHANNEL_VOICE_HOLD_FIRST_MS`. Each is checking, looking-up
 * or chewing wording that asks a short pause. None names what the speaker is, since no
 * per-utterance disclosure is spoken: the honesty rule in the prompt answers that when it is asked.
 * None promises a result, since the session may answer with nothing to report. Each is words only,
 * with no filler sound, so the speaker never voices a non-word.
 */
export const THINKING_LINES: readonly [string, string, string, string] = [
  "Hold on, let me chew on that.",
  "Hold on, I'm checking.",
  "Stand by, let me look that up.",
  "Give me a moment, I need to check that.",
];

/**
 * The still-looking lines, a closed set of six, one spoken round-robin where the reply has still
 * not reached the speaker by `CHANNEL_VOICE_HOLD_SECOND_MS`. Held to the thinking lines' wording
 * rule: checking, looking-up, chewing or reading wording that asks a short pause, no promise, no
 * statement of what the speaker is, and words only.
 */
export const STILL_LOOKING_LINES: readonly [string, string, string, string, string, string] = [
  "Still checking, hold on.",
  "Still looking that up.",
  "Bear with me, I'm still reading.",
  "Not done yet, still checking.",
  "Still chewing on it, a little longer.",
  "One more moment, still reading.",
];
