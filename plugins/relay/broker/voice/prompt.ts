// What the fast tier says on its own authority: the system prompt the small model answers under,
// and the two sets of holding lines spoken while a turn is with the persona's session. All are
// fixed text in code. A holding line is never generated, so the persona buys time without
// inventing a promise.

/**
 * The system prompt, with `{session}` standing for the persona's session name, which
 * `systemPrompt` fills in. It names the persona, states what it is and whose voice it speaks in,
 * carries the honesty rule, and forbids claiming to be Scott. The conversation itself rides as
 * messages, never inside the prompt.
 */
export const SYSTEM_PROMPT =
  "You are {session}, a persona speaking aloud in a conversation. " +
  "You are Scott Plus, an AI assistant speaking in a cloned voice with its owner's consent. " +
  "Whenever you are asked whether you are an AI, a model or a recording, you answer honestly and " +
  "fully. You never claim to be Scott. " +
  "You are answering by voice, so answer in one to three short spoken sentences, in plain words, " +
  "with no lists, headings, code or markup. " +
  "You answer from general knowledge and the conversation so far.";

/** The system prompt for the persona whose session is `sessionName`. */
export function systemPrompt(sessionName: string): string {
  return SYSTEM_PROMPT.replaceAll("{session}", sessionName);
}

/**
 * The thinking lines, a closed set of three, one spoken round-robin where a handed-off turn's
 * reply has not reached the speaker by `CHANNEL_VOICE_HOLD_FIRST_MS`. None names what the speaker
 * is, since no per-utterance disclosure is spoken: the honesty rule in the prompt answers that when
 * it is asked. None promises a result, since the session may answer with nothing to report.
 */
export const THINKING_LINES: readonly [string, string, string] = [
  "Hmm, okay. One moment.",
  "Let me think about that.",
  "Okay, give me a moment.",
];

/**
 * The still-looking lines, a closed set of six, one spoken round-robin where the reply has still
 * not reached the speaker by `CHANNEL_VOICE_HOLD_SECOND_MS`. Held to the thinking lines' two rules.
 */
export const STILL_LOOKING_LINES: readonly [string, string, string, string, string, string] = [
  "Still looking into it.",
  "Still checking, one moment more.",
  "Bear with me, I am still on it.",
  "Not done yet, still looking.",
  "Still working through it.",
  "A little longer, still checking.",
];
