// channel-text.ts: channel and record text: the envelope attributes and sender a channel event
// carries, the expected-turn list a submitted turn is matched against, the task
// text bounds, the channel segment path and the bounds on text a record keeps.
//
// No import of the engine handle and no state of its own: every function takes what it
// reads as arguments, so the tick harness, which loads a fresh hooks/index.ts per
// case, shares nothing through it.

import { personaNameProblem } from "./operator";

// The persona an agentic_say or agentic_inbox call addresses: the `persona`
// argument when given, else the session's own persona. A given name passes
// personaNameProblem, the one rule for a name that reaches a store key.
export function targetPersonaOf(arg: unknown, own: string): { persona: string } | { deny: string } {
  if (arg === undefined || arg === null) return { persona: own };
  const problem = personaNameProblem(arg);
  if (problem) return { deny: `'persona' ${problem}${typeof arg === "string" ? ` (got '${arg.trim()}')` : ""}.` };
  return { persona: (arg as string).trim() };
}

// One turn this plugin's own $.prompt.submit has queued and that has not
// opened yet; the list and its match rules are described at register()'s
// `expectedTurns`. An entry carries two match keys. `text` is the string
// handed to the submit. `settledText` is the text the resolved submit
// reports, which is the text as the hook chain beneath this plugin left it
// (another plugin's prompt.submit hook may rewrite it, and the engine caps
// it whole), and the text the turn then opens with. Both are kept because
// the contract does not order the submit promise settling against
// turn.start: a turn that opens before the submit's continuation has run
// matches on `text` where nothing rewrote the text, and one that opens
// after matches on `settledText` either way. A
// UserPromptSubmit settings hook cannot rewrite the text, since its output
// carries no text field, and a prompt it suppresses leaves no turn that
// matches either key. A turn that opens with a rewritten or capped text
// before the submit's continuation has stored the settled text matches
// neither key either. Such a delivery's turn reads unaccounted, and its
// entry then leaves the list at the withheld branch once its record is
// swept or resolved.
//
// A delivery entry also carries what the effort gate reads for its turn,
// fixed when the entry is built: `ground`, the value deliveryGroundIn gave
// the record, `seatLead`, whether the record's own text opens with
// [FINDING], [PROPOSAL] or [STARTED], `queueLead`, whether it opens with
// [QUEUE], the lead the architect persona writes on a queue instruction and
// on nothing else, and `deliveredTo`, the persona the session held when the
// drain built the entry, so the gate's architect branch reads the lead and
// the persona the record reached, never the text at the act or the persona
// the session holds then, which agentic_identity can change inside the turn.
// `answersAsk` is set on the one
// delivery the ask-answer path queues, the record that answers an open
// ask, and is absent on every other, so the turn-score call's next_trigger outcome can
// tell an answered ask from any other delivered record.
//
// A proposal entry is the idle proposal's [PROPOSE] turn. It is a plugin
// turn in every other respect, and its own kind is what lets the agentic_say
// handler ledger the proposal the persona sends inside it.
//
// A memoryCheck entry is the [MEMORY CHECK] turn a goal's close queues. It
// carries the closed goal's id and the ids of every goal the close completed
// with it, so the turn's answer is read against the records shown under those
// goals and no other.
//
// A reprompt entry is the [MID-TURN MESSAGE] turn hooks/mid-turn-reprompt.ts
// queues at a turn's end for the operator-class messages that arrived while
// that turn ran. It carries the timestamps of the transcript records it
// covers and the class the scan read, which is only ever the operator's. A
// turn that matched it stands as the operator's own for the effort gate, the
// autonomy tool and the ask lift; every other consumer of the kind treats it
// as a plugin entry.
export type ExpectedTurn = { text: string; settledText?: string } & ({ kind: "delivery"; recordId: string; ground: string; seatLead: boolean; queueLead: boolean; deliveredTo: string; answersAsk?: true } | { kind: "nudge" } | { kind: "plugin" } | { kind: "proposal" } | { kind: "memoryCheck"; goalId: string; goalIds: string[] } | { kind: "reprompt"; coveredAt: number[]; senderClass: "operator" });

// Whether a turn's opening text is the text an entry was submitted with, on
// either of the entry's two keys. An empty turn text (a continuation) and an
// empty key match nothing, since an empty string is inside every text.
//
// Two rules. Equality is the first, and the one the origin readings the
// prompt.submit hook keeps take alone, since the engine never frames an
// external prompt. Framed containment is the second, for the expected-turn
// list only: from Claude Code 2.1.280 the engine opens a plugin-submitted
// turn with the submitted text inside its own frame ("The <plugin> plugin
// sent a message:", a line break, the text, a blank line, then a sentence
// saying how the prompt reached the model), so the turn's text holds the
// key as whole lines rather than equalling it. The key is matched between
// line breaks, so a key that is a prefix of another entry's key, or a word
// that happens to appear in the frame's own sentence, matches nothing.
// findExpectedTurn prefers an exact match over the list before any framed
// one, so a foreign turn that quotes a queued entry's text whole takes it
// only where no entry equals the turn's text.
export function turnTextEquals(turnText: string, entry: { text: string; settledText?: string }): boolean {
  if (turnText === "") return false;
  return turnText === entry.text || (entry.settledText !== undefined && entry.settledText !== "" && turnText === entry.settledText);
}

function turnTextFrames(turnText: string, entry: { text: string; settledText?: string }): boolean {
  if (turnText === "") return false;
  const keys = entry.settledText !== undefined ? [entry.text, entry.settledText] : [entry.text];
  return keys.some((key) => key !== "" && turnText.includes(`\n${key}\n`));
}

export function findExpectedTurn(list: ExpectedTurn[], turnText: string): ExpectedTurn | undefined {
  return list.find((entry) => turnTextEquals(turnText, entry)) ?? list.find((entry) => turnTextFrames(turnText, entry));
}

// Who sent a relayed channel message, as the broker writes it on the
// envelope the harness wraps the message in:
//   <channel source="..." chat_id="..." author="..." sender_class="...">
// with the text on the lines below and </channel> closing it. A class of
// exactly "operator", and an envelope with no class, is the operator's, so a
// broker that writes no class keeps every channel turn's standing. Every other
// class value, "participant" included, is a person in the thread with no
// authority, so a value the plugin does not know fails toward none. The author
// is the sender's name, or empty where the envelope names none.
export type ChannelSender = { senderClass: "operator" | "participant"; author: string };

export const OPERATOR_SENDER: ChannelSender = { senderClass: "operator", author: "" };

// The most characters of an author a goal root's askedBy stores, the width
// bin/restart-recap.mjs gives an author on a digest line (RECAP_AUTHOR_CHARS).
export const ASKED_BY_MAX_CHARS = 64;

// The five XML entities this reader decodes in an attribute value, in one
// pass so a decoded "&" never starts a second decode.
const ENVELOPE_ENTITIES: Readonly<Record<string, string>> = { quot: '"', amp: "&", lt: "<", gt: ">", apos: "'" };

function decodeEnvelopeAttribute(value: string): string {
  return value.replace(/&(quot|amp|lt|gt|apos);/g, (_, name: string) => ENVELOPE_ENTITIES[name]);
}

// The attributes of the channel envelope's opening tag as name and value
// pairs in the order the tag gives them, or null where the text does not open
// with a whole one. Only a tag at the very start of the text is read: a
// <channel sequence anywhere later is the message's own content, which the
// sender wrote. The tag is read as a run of name="value" pairs up to its
// closing '>', so a '>' inside a quoted value does not end it. The tag is
// whole only where that '>' ends its line, followed by a line break or the
// end of the text, since the envelope puts the message on the lines below:
// anything else after it on the tag's line is text that broke the tag, such
// as an author value holding an unescaped '">'. The whole tag sits on one
// line: a line break inside an attribute value, between two pairs, or before
// the closing '>' breaks it. A name given twice appears twice.
function channelEnvelopeAttributes(text: string): Array<[string, string]> | null {
  const open = "<channel";
  if (!text.startsWith(open)) return null;
  const pair = /[ \t]+([A-Za-z_][\w.:-]*)="([^"\r\n]*)"/y;
  const attributes: Array<[string, string]> = [];
  let at = open.length;
  for (;;) {
    pair.lastIndex = at;
    const m = pair.exec(text);
    if (!m) break;
    attributes.push([m[1], decodeEnvelopeAttribute(m[2])]);
    at = pair.lastIndex;
  }
  return /^[ \t]*>(?:\r?\n|$)/.test(text.slice(at)) ? attributes : null;
}

// The sender a channel prompt's envelope names. A text that does not open
// with <channel reads as the operator's with no author. A text that opens
// with <channel reads as a participant with no author where its tag does not
// parse whole, or where the tag names sender_class more than once: either
// shape can come from author text the envelope did not escape, so neither may
// decide the class. A whole tag with no sender_class, or with one whose value
// is exactly "operator", reads as the operator; one with any other value reads
// as a participant. The author is the first author attribute's value, or
// empty where the tag names none.
export function channelSenderOf(text: string): ChannelSender {
  if (!text.startsWith("<channel")) return OPERATOR_SENDER;
  const attributes = channelEnvelopeAttributes(text);
  const classes = attributes === null ? [] : attributes.filter(([name]) => name === "sender_class");
  if (attributes === null || classes.length > 1) return { senderClass: "participant", author: "" };
  return {
    senderClass: classes.length === 0 || classes[0][1] === "operator" ? "operator" : "participant",
    author: attributes.find(([name]) => name === "author")?.[1] ?? "",
  };
}

// The longest a task's text is kept at store time. task_add cuts here the
// same way goal_add cuts an objective to 500: at write, with .slice, not by
// refusing a long call.
export const TASK_TEXT_MAX_CHARS = 200;

// The longest a task's id, or the active goal's id, is rendered at. Both
// are plugin-minted rather than free persona text, but the render-time
// guard treats them the same as task text: a length cap it applies to
// itself rather than trusting the mint site.
export const TASK_ID_MAX_CHARS = 64;

export type SubmitOutcome = { ok: true } | { ok: false; how: "failed" | "dropped"; reason: string };

// Removes one entry from the expected-turn list by identity, never by
// position; an entry already gone is left alone.
export function removeExpectedTurn(expectedTurns: ExpectedTurn[], entry: ExpectedTurn): void {
  const i = expectedTurns.indexOf(entry);
  if (i >= 0) expectedTurns.splice(i, 1);
}

// Item 5 (Bounded store): the one append-only rollover log every capped
// store writes to when something falls off its window - the commons
// store's closed inbox/reply records (enforceChannelWindow and
// sweepExpiredRecords) and the persona file's own decision log and memory
// cap (persist() in hooks/index.ts). Same one-JSON-object-per-line rule as the yield
// log. The engine offers no append, so an append reads the file whole and
// writes it back whole, and the engine refuses a read or a write over
// 4,194,304 bytes: the typings state the read bound, and the write bound is
// the refusal `$.fs.write` returns. So the log is a series of segments,
// `.agentic-channel.0001.jsonl` and up: an append lands in the
// highest-numbered one until that file plus the batch would pass
// CHANNEL_SEGMENT_MAX_BYTES, and then opens the next number. The bound sits
// far under the engine's cap because each append rewrites its whole segment.
// A work directory can hold a `.agentic-channel.jsonl` from before the
// segments; its name carries no number, so the pattern never selects it and
// nothing writes it again.
const CHANNEL_SEGMENT_PREFIX = ".agentic-channel.";

const CHANNEL_SEGMENT_SUFFIX = ".jsonl";

export const CHANNEL_SEGMENT_PATTERN = /^\.agentic-channel\.(\d{4,})\.jsonl$/;

export const CHANNEL_SEGMENT_MAX_BYTES = 1_048_576;

export const channelSegmentPath = (n: number): string => `${CHANNEL_SEGMENT_PREFIX}${String(n).padStart(4, "0")}${CHANNEL_SEGMENT_SUFFIX}`;
