// The ranking of a finished spoken turn: the two yes-or-no questions Jev is asked about it, the
// state they are asked over, and the fixed rule that turns the two answers into a verdict. Jev only
// ranks; it never speaks, and nothing here sends anything. The fast tier in fast.ts makes the call
// through the Jev client and reads the verdict from `decide`.
//
// The state is `{conversation, turn}`: the memory ring before the turn, one line per spoken line in
// the buffered line form the response gate's questions read, and the new turn's text alone.
import type { JevQuestion, JevResult } from "../jev/client.ts";
import type { RepeatLogSurface } from "../repeat-log.ts";
import type { SpokenLine } from "./speaker.ts";

/** The two answers a ranking call reads out, keyed by the name each comes back under. */
export type RankQuestion = "answer_now" | "needs_fleet";

/** The verdict the rule reaches: the fast tier answers, or the turn goes to the persona's session. */
export type Verdict = "answer" | "handoff";

/** The two thresholds the rule reads the answers against, each a probability from 0.3 to 0.9. */
export type RankThresholds = { readonly handoff: number; readonly answer: number };

/** The display names the buffered line form carries: the operator's and the persona's session. */
export type LineNames = { readonly speaker: string; readonly session: string };

const PREAMBLE =
  "The `conversation` is the newest part of a spoken exchange between a person and an AI " +
  "assistant, one line per spoken turn, oldest first, the person's lines written as " +
  "`<name> (operator): <text>` and the assistant's as `<name> (voice): <text>`. `turn` is " +
  "what the person just said, which the assistant must now answer. The assistant has a small " +
  "model that answers at once from general knowledge and the conversation alone, and a full " +
  "session behind it with the person's files, tools, projects and other assistants, which takes " +
  "longer.";

/**
 * The two questions, yes-or-no (`noul`), keyed by the name each answer comes back under. The text
 * is a first wording rather than a tuned one.
 */
export const RANK_QUESTIONS: Readonly<Record<RankQuestion, JevQuestion>> = {
  answer_now: {
    type: "noul",
    instructions:
      `${PREAMBLE} Can the small model answer the turn well from general knowledge and the ` +
      "conversation alone? Count a greeting, a factual question, a definition, a short " +
      "explanation, a clarification of something already said, and small talk. A turn that " +
      "needs anything the person owns, anything that happened recently, or any action taken does " +
      "not count.",
    criteria: {
      true: "Yes, the small model can answer the turn well on its own.",
      false: "No, the small model cannot answer the turn well on its own.",
    },
  },
  needs_fleet: {
    type: "noul",
    instructions:
      `${PREAMBLE} Does answering the turn need the full session: the person's files, projects, ` +
      "plans or tools, something that happened recently, an action to be taken, or another " +
      "assistant? Count a request to do, check, change, run, send, look up or remember something " +
      "of the person's, and a question about the person's own work or state. A question the " +
      "small model can answer from general knowledge alone does not count.",
    criteria: {
      true: "Yes, the turn needs the full session.",
      false: "No, the turn does not need the full session.",
    },
  },
};

/**
 * The ranking's repeat log, keyed by the failure kind with the submission key beside it, which is
 * the turn number and a submission count behind a slash; the line names the turn alone. The kinds
 * are the client's closed set plus a handler throw, so the map is bounded without a sweep. A line
 * carries no text, since the turn is the operator's words.
 */
export const RANK_REPEAT_LOG: RepeatLogSurface<[submission: string]> = {
  windowMs: 60_000,
  firstLine: (kind, submission) =>
    `voice: ranking a turn failed (${kind}) turn=${submission.split("/")[0]}, so it is handed off`,
  countLine: (kind, suppressed) =>
    `voice: ranking failed (${kind}) ${String(suppressed)} more time(s) in the last 60000ms`,
};

/**
 * The fixed rule, in this order: `needs_fleet` at or above the hand-off threshold hands off; else
 * `answer_now` at or above the answer threshold answers; else the turn hands off. A call that
 * failed, whatever its kind, hands off, so the persona's session is the floor and never the
 * ceiling.
 */
export function decide(result: JevResult<RankQuestion>, thresholds: RankThresholds): Verdict {
  if (!result.ok) return "handoff";
  if (result.answers.needs_fleet >= thresholds.handoff) return "handoff";
  if (result.answers.answer_now >= thresholds.answer) return "answer";
  return "handoff";
}

/**
 * One spoken line in the ring's buffered form, the one a hand-off carries to the session too:
 * `<display name> (operator): <text>` for a `user` line and `<session name> (voice): <text>` for a
 * `persona` line. A `persona` line's text is one line: every run of whitespace, line breaks
 * included, is one space, and the ends are trimmed. Speech carries no line structure, and a break
 * kept would stand its continuation unprefixed inside a hand-off event of class operator, where a
 * continuation shaped `<name> (operator): <text>` reads as the person's own line. A `user` line is
 * the transcript as heard, kept as it is.
 */
export function conversationLine(line: SpokenLine, names: LineNames): string {
  return line.role === "user"
    ? `${names.speaker} (operator): ${line.text}`
    : `${names.session} (voice): ${line.text.replace(/\s+/g, " ").trim()}`;
}

/** The state one ranking call is asked over: the ring before the turn, in line form, and the turn. */
export function rankState(
  conversation: readonly SpokenLine[],
  turn: string,
  names: LineNames,
): { conversation: string[]; turn: string } {
  return { conversation: conversation.map((line) => conversationLine(line, names)), turn };
}
