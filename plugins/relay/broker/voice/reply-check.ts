// The reply check: a closed, fixed-text test run over the small model's reply before it is spoken.
// A reply that carries the hand-off token, that speaks about the speaker's own reach or ability,
// or that takes back an earlier line is not the persona's to say, so the fast tier hands its turn
// off instead of speaking it. The two phrase lists are literals in code, read and tested in full,
// and the check makes no call. The module is pure and takes any string without throwing.
//
// Both the reply and every list entry are normalised the same way before matching: trimmed,
// case-folded, whitespace runs collapsed to one space, and the apostrophe look-alikes (U+2018,
// U+2019, U+02BC and U+2032) read as straight ones, so "I Don’t  have access" matches the entry
// "I don't have access".
import { HAND_OFF_REPLY } from "./prompt.ts";

/** What a caught reply is: the hand-off token, a remark on reach or ability, or a walk-back. */
export type ReplyKind = "hand-off" | "access" | "walk-back";

/**
 * Phrases about the speaker's own reach or ability. Each is first person and a whole phrase, long
 * enough that a light reply does not open with it: "I can't see why not" and "I'm just a bit
 * tired" match nothing here. A reply about the person, "you can't see that from here", is not
 * caught. The honest disclosure the prompt asks for, "I'm an AI assistant speaking in a cloned
 * voice", matches nothing here. "I'm just an assistant" and "I'm only an assistant" are caught by
 * design, so the turn is handed off rather than a disclaimer spoken.
 */
export const ACCESS_PHRASES: readonly string[] = [
  "I don't have access",
  "I do not have access",
  "I can't access",
  "I cannot access",
  "I can't see your",
  "I cannot see your",
  "I can't answer that",
  "I cannot answer that",
  "I can't do that",
  "I cannot do that",
  "I can't help with that",
  "I cannot help with that",
  "I'm not able to",
  "I am not able to",
  "I'm unable to",
  "I am unable to",
  "I don't have the ability",
  "I do not have the ability",
  "I don't have visibility",
  "I do not have visibility",
  "I have no way to check",
  "I have no way to see",
  "I don't have that information",
  "I do not have that information",
  "I'm just an assistant",
  "I'm only an assistant",
];

/**
 * Phrases that correct or regret an earlier line. Each is first person and a whole phrase. An
 * apology is caught only where it names confusion, an error or a mistake, so "I apologize for the
 * wait" passes, as do "sorry to hear that" and "happy to help".
 */
export const WALK_BACK_PHRASES: readonly string[] = [
  "I was wrong",
  "I was mistaken",
  "I misspoke",
  "I made a mistake",
  "I made an error",
  "I stand corrected",
  "my mistake",
  "let me correct",
  "to correct what I said",
  "scratch what I said",
  "I shouldn't have said",
  "what I said earlier was",
  "I apologize for the confusion",
  "I apologise for the confusion",
  "I apologize for any confusion",
  "I apologise for any confusion",
  "I apologize for the error",
  "I apologise for the error",
  "I apologize for the mistake",
  "I apologise for the mistake",
];

/** The form a reply and an entry are compared in: trimmed, case-folded, spaced once, straight apostrophes. */
function normalised(text: string): string {
  return text.replace(/[\u2018\u2019\u02bc\u2032]/g, "'").replace(/\s+/g, " ").trim().toLowerCase();
}

/** A regular expression source matching `text` literally. */
function literal(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The hand-off token as a pattern, built from the normalised `HAND_OFF_REPLY` so the prompt's
 * constant stays the one source. The token is a bracketed phrase: inside its brackets a space may
 * open and close the phrase, and each space between its words may be a space, a hyphen or nothing,
 * so "[hand off]", "[ hand off ]", "[hand-off]" and "[handoff]" all match.
 */
const HAND_OFF_TOKEN = ((): RegExp => {
  const token = normalised(HAND_OFF_REPLY);
  const inner = token.slice(1, -1).split(" ").map(literal).join("[\\s-]?");
  return new RegExp(`${literal(token[0])}\\s?${inner}\\s?${literal(token[token.length - 1])}`);
})();
const ACCESS = ACCESS_PHRASES.map(normalised);
const WALK_BACK = WALK_BACK_PHRASES.map(normalised);

/**
 * The kind of a reply the fast tier must not speak, or null for a reply it may. Checked in order:
 * the hand-off token, then the access phrases, then the walk-back phrases, so a reply carrying more
 * than one is named by the first. The token counts anywhere in the reply, since the bracketed token
 * is never the persona's speech, so "[Hand off].", "Sure, [hand off]." and "**[handoff]**" are all
 * hand-offs. An unbracketed "hand off" is ordinary speech and is not the token. A phrase counts
 * anywhere in the reply.
 */
export function replyKind(text: string): ReplyKind | null {
  const reply = normalised(text);
  if (HAND_OFF_TOKEN.test(reply)) return "hand-off";
  if (ACCESS.some((phrase) => reply.includes(phrase))) return "access";
  if (WALK_BACK.some((phrase) => reply.includes(phrase))) return "walk-back";
  return null;
}
