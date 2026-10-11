// The completeness question the turn hold asks Jev about a finished spoken turn: whether the words
// read as a whole thought or as one cut off mid-sentence. Jev only answers; it never speaks, and
// nothing here sends anything. The hold in turn-hold.ts makes the call through the Jev client and
// reads the answer through `isComplete`.
//
// The state is `{turn}`: the held turn's text alone, as the speech recognizer wrote it. The wording
// is the one the plan's measurement froze before scoring its held-out rows, and a change to it is a
// change to what was measured.
import { MAX_JEV_CODE_POINTS } from "../jev/client.ts";
import type { JevQuestion, JevResult } from "../jev/client.ts";
import type { RepeatLogSurface } from "../repeat-log.ts";

/** The one answer a completeness call reads out, keyed by the name it comes back under. */
export type CompleteQuestion = "complete";

const PREAMBLE =
  "`turn` is what a person just said aloud to an AI assistant, as a speech recognizer wrote it " +
  "down. The recognizer ends a turn when the person pauses, and a person pausing to think is " +
  "sometimes cut off before the thought is finished; the rest then arrives a few seconds later as " +
  "a turn of its own.";

const ASK =
  " Has the person finished the thought, so that the assistant should answer now? Count a " +
  "complete sentence or question, a short answer, a greeting, thanks, an acknowledgment or a " +
  "goodbye. Do not count a turn that ends on a connective, an article, a preposition or a subject " +
  "with no verb, a request whose object or details are plainly still to come, or a turn that only " +
  "clears the throat before a thought.";

/**
 * The one question, yes-or-no (`noul`), keyed by the name its answer comes back under. The answer
 * is the probability that the thought is finished, so a threshold reads against that chance.
 */
export const COMPLETE_QUESTIONS: Readonly<Record<CompleteQuestion, JevQuestion>> = {
  complete: {
    type: "noul",
    instructions: PREAMBLE + ASK,
    criteria: {
      true: "Yes, the person has finished the thought.",
      false: "No, the person was cut off before finishing the thought.",
    },
  },
};

/**
 * The hold's repeat log, in the ranking's shape: keyed by the failure kind with the submission key
 * beside it, which is the turn number and a submission count behind a slash; the line names the
 * turn alone. The kinds are the client's closed set plus a handler throw, so the map is bounded
 * without a sweep. A line carries no text, since the turn is the operator's words.
 */
export const COMPLETE_REPEAT_LOG: RepeatLogSurface<[submission: string]> = {
  windowMs: 60_000,
  firstLine: (kind, submission) =>
    `voice: judging a turn's completeness failed (${kind}) turn=${submission.split("/")[0]}, so the hold waits out its timer`,
  countLine: (kind, suppressed) =>
    `voice: judging completeness failed (${kind}) ${String(suppressed)} more time(s) in the last 60000ms`,
};

/**
 * Whether Jev's answer releases the hold at once: the finished-thought probability at or above the
 * threshold. A call that failed, whatever its kind, reads false, so the timer is the floor on every
 * failure path.
 */
export function isComplete(result: JevResult<CompleteQuestion>, threshold: number): boolean {
  return result.ok && result.answers.complete >= threshold;
}

/**
 * The state one completeness call is asked over: the held turn's text alone, cut to its last
 * `MAX_JEV_CODE_POINTS`, since how a turn ends decides whether it is finished.
 */
export function completeState(turn: string): { turn: string } {
  const points = [...turn];
  return { turn: points.length > MAX_JEV_CODE_POINTS ? points.slice(-MAX_JEV_CODE_POINTS).join("") : turn };
}
