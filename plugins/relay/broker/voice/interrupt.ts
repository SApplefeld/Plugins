// The judging stage: a `Transcriber` wrapped around the one it is given, so a turn the operator
// speaks over a paused reading is read by what it means before anything acts on its end. The stage
// holds that one `end`, emits it with a verdict of stop, addressed or stray, and emits every event
// that arrived meanwhile after it, in order. Every other event passes through at once and unread:
// a turn that ends with no reading paused carries no verdict and costs no call and no wait.
//
// An end is judged in this order. A turn that is exactly a stop phrase is a stop, with no call. Any
// other turn is asked of Jev as one question, whether it is said to the assistant, and the answer
// is read against the threshold. Where there is no Jev key, the call fails, the secret screen
// refuses the turn or no answer arrives inside `INTERRUPT_WAIT_MS`, the turn's word count decides,
// as it does for a turn the stage does not judge.
//
// The stage keeps one listener list of its own, called in subscription order, so the barge-in rule
// and the bridge read one verdict on the same end in the same tick, and the barge-in rule still
// runs ahead of the bridge for every event.
//
// What leaves the machine for the question is the turn's text alone, screened by the Jev client.
// Nothing of the reply being read is sent. Nothing this file logs carries the operator's words: a
// judgment's line names the turn number, the verdict and how it was reached, and a Jev failure is
// logged by its kind alone through the repeat log.
import { MAX_JEV_CODE_POINTS, createJevClient } from "../jev/client.ts";
import type { JevFetch, JevQuestion, JevResult } from "../jev/client.ts";
import type { RepeatLogSurface } from "../repeat-log.ts";
import { wordCount } from "./transcriber.ts";
import type { InterruptVerdict, Transcriber, TurnEvent } from "./transcriber.ts";

/**
 * The stop phrases, a closed list of seventeen, each in its normalised form. A turn stops a reading
 * with no call only where its normalised text is exactly one of them, so a phrase with any other
 * word in it is judged by meaning instead.
 */
export const STOP_PHRASES: readonly string[] = [
  "stop",
  "stop please",
  "please stop",
  "okay stop",
  "ok stop",
  "stop reading",
  "stop talking",
  "never mind",
  "nevermind",
  "cancel",
  "cancel that",
  "enough",
  "that's enough",
  "thats enough",
  "that is enough",
  "shut up",
  "be quiet",
];

/** The line spoken when a stop phrase stops a reading. */
export const STOPPED_LINE = "Okay, stopped.";

/**
 * The form a turn is compared with the stop phrases in. In order: the apostrophe look-alikes
 * (U+2018, U+2019, U+02BC and U+2032) become straight apostrophes, the text is lowercased, every
 * character that is not a Unicode letter, a digit or an apostrophe becomes a space, and runs of
 * spaces collapse to one with the ends trimmed.
 */
export function normaliseStop(text: string): string {
  return text
    .replace(/[‘’ʼ′]/g, "'")
    .toLowerCase()
    .replace(/[^\p{L}\p{Nd}']/gu, " ")
    .replace(/ +/g, " ")
    .trim();
}

/** Whether the turn is exactly a stop phrase once normalised. */
export function isStopPhrase(text: string): boolean {
  return STOP_PHRASES.includes(normaliseStop(text));
}

/** The one answer an interruption call reads out, keyed by the name it comes back under. */
export type AddressedQuestion = "addressed";

/**
 * The one question, yes-or-no (`noul`), keyed by the name its answer comes back under. The answer
 * is the probability that the turn is said to the assistant. The wording is the one the plan's
 * measurement froze before scoring its held-out rows, and a change to it is a change to what was
 * measured.
 */
export const ADDRESSED_QUESTIONS: Readonly<Record<AddressedQuestion, JevQuestion>> = {
  addressed: {
    type: "noul",
    instructions:
      "`turn` is what a person just said aloud while an AI voice assistant was reading a reply to " +
      "them, as a speech recognizer wrote it down. The person may be driving or have other people " +
      "nearby. Is the person speaking to the assistant: asking it something, telling it to do " +
      "something, or telling it to stop, wait, skip, repeat or move on? Do not count a sound or a " +
      "word that only shows they are listening, such as mm-hm, right, okay or wow, a reaction to " +
      "what they heard that asks for nothing, or words meant for someone else. Words meant for " +
      "someone else include a request or a reply to a person nearby, such as a passenger, someone " +
      "on a phone call, or someone taking an order, and an apology or a greeting to them.",
    criteria: {
      true: "Yes, the person is speaking to the assistant.",
      false: "No, the person is only reacting, or is speaking to someone else.",
    },
  },
};

/**
 * The stage's repeat log, in the turn hold's shape: keyed by the failure kind with the submission
 * key beside it, which is the turn number and a submission count behind a slash; the line names
 * the turn alone. The kinds are the client's closed set plus a handler throw, so the map is bounded
 * without a sweep. A line carries no text, since the turn is the operator's words.
 */
export const ADDRESSED_REPEAT_LOG: RepeatLogSurface<[submission: string]> = {
  windowMs: 60_000,
  firstLine: (kind, submission) =>
    `voice: judging an interruption failed (${kind}) turn=${submission.split("/")[0]}, so the turn's length decides`,
  countLine: (kind, suppressed) =>
    `voice: judging an interruption failed (${kind}) ${String(suppressed)} more time(s) in the last 60000ms`,
};

/**
 * The state one interruption call is asked over: the turn's text alone, cut to its last
 * `MAX_JEV_CODE_POINTS`. Nothing of the reply being read is in it.
 */
export function addressedState(turn: string): { turn: string } {
  const points = [...turn];
  return { turn: points.length > MAX_JEV_CODE_POINTS ? points.slice(-MAX_JEV_CODE_POINTS).join("") : turn };
}

/**
 * How long the stage waits on Jev before the turn's word count decides. A timer of the stage's own
 * beside the call: the call is left to finish under the client's timeout, and its answer is dropped.
 */
export const INTERRUPT_WAIT_MS = 1_500;

export type InterruptStageOptions = {
  /**
   * Whether a reading is paused: the barge-in rule's mid-reply check, a speech handed to the
   * speaker that has not settled or frames the player holds. Read once for each end with words.
   */
  reading: () => boolean;
  /** `CHANNEL_VOICE_INTERRUPT_THRESHOLD`: the probability at or above which a turn is addressed. */
  threshold: number;
  /** `CHANNEL_VOICE_SHORT_TURN_WORDS`: the word count that decides where Jev gives no answer. */
  shortTurnWords: number;
  /**
   * The Jev key the stage's own client is built over, or null, which leaves every turn that is
   * not a stop phrase to its word count. `fetch` is injected so a test drives the call without a
   * network.
   */
  judge: { apiKey: string; fetch?: JevFetch } | null;
  log?: (message: string) => void;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  now?: () => number;
};

/** A judged end: an `end` event with words, never a lost one. */
type JudgedEnd = Extract<TurnEvent, { kind: "end"; lost?: undefined }>;

/** The one judgment open: the end it holds, the timer beside its call, and when it was asked. */
type Judgment = { end: JudgedEnd; timer: NodeJS.Timeout; askedAt: number };

/**
 * Wraps `inner` in the stage. Subscribes to it once, at once, and emits to its own listeners.
 * `push` and `close` reach the inner transcriber; `close` first drops the end being judged and
 * every event queued behind it unemitted and clears the timer, since the channel is leaving and
 * every consumer's leave drops its work.
 */
export function createInterruptStage(inner: Transcriber, options: InterruptStageOptions): Transcriber {
  const log = options.log ?? ((): void => {});
  // A pending judgment never keeps the broker's process alive at shutdown.
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref());
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const now = options.now ?? Date.now;

  // In subscription order, which is the order each is called in for every event.
  const listeners: Array<(event: TurnEvent) => void> = [];
  let closed = false;
  let judging: Judgment | null = null;
  // The events that arrived while an end was being judged, oldest first.
  const queued: TurnEvent[] = [];
  /** Counts submissions, so no two ever share a key at the Jev client. */
  let submissions = 0;

  function emit(event: TurnEvent): void {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // The error is not logged: a consumer's message can carry the turn's text.
        log(`voice: a turn consumer failed on a ${event.kind} event`);
      }
    }
  }

  /** Emits the end with its verdict and one line saying how it was reached, with no word of it. */
  function decided(end: JudgedEnd, verdict: InterruptVerdict, how: string): void {
    log(`voice: interruption turn=${String(end.turn)} ${verdict} by ${how}`);
    emit({ ...end, verdict });
  }

  /** The word count's reading, for a turn Jev gave no answer on. */
  function floor(end: JudgedEnd, cause: string): void {
    const verdict = wordCount(end.text) < options.shortTurnWords ? "stray" : "addressed";
    decided(end, verdict, `length (${cause})`);
  }

  /**
   * Closes the judgment where it is still the open one, and answers whether it was. An answer or a
   * timer for a judgment already closed, by the other of the two or by the leave, is late and
   * changes nothing.
   */
  function settled(judgment: Judgment): boolean {
    if (judging !== judgment) return false;
    clearTimer(judgment.timer);
    judging = null;
    return true;
  }

  const judge =
    options.judge === null
      ? null
      : createJevClient<AddressedQuestion, Judgment>({
          apiKey: options.judge.apiKey,
          questions: ADDRESSED_QUESTIONS,
          repeatLog: ADDRESSED_REPEAT_LOG,
          ...(options.judge.fetch === undefined ? {} : { fetch: options.judge.fetch }),
          log,
          now,
          onResult: (_key, judgment, result: JevResult<AddressedQuestion>) => {
            if (!settled(judgment)) return;
            if (result.ok) {
              const probability = result.answers.addressed;
              decided(
                judgment.end,
                probability >= options.threshold ? "addressed" : "stray",
                `jev=${probability.toFixed(2)} in ${String(now() - judgment.askedAt)}ms`,
              );
            } else {
              // The failure is already on the repeat log by its kind.
              floor(judgment.end, result.kind);
            }
            drain();
          },
        });

  /** One event in its turn: an end with words over a paused reading is judged, the rest emitted. */
  function take(event: TurnEvent): void {
    if (event.kind !== "end" || event.lost === true || wordCount(event.text) === 0 || !options.reading()) {
      emit(event);
      return;
    }
    if (isStopPhrase(event.text)) {
      decided(event, "stop", "a stop phrase");
      return;
    }
    if (judge === null) {
      floor(event, "no key");
      return;
    }
    const judgment: Judgment = {
      end: event,
      timer: setTimer(() => {
        if (!settled(judgment)) return;
        floor(judgment.end, `no answer in ${String(INTERRUPT_WAIT_MS)}ms`);
        drain();
      }, INTERRUPT_WAIT_MS),
      askedAt: now(),
    };
    // Open before the submission: the client settles a screened state inside `submit`.
    judging = judgment;
    submissions += 1;
    judge.submit(`${String(event.turn)}/${String(submissions)}`, addressedState(event.text), judgment);
  }

  /** Emits the queued events in order, until one of them opens a judgment of its own. */
  function drain(): void {
    while (judging === null && !closed) {
      const next = queued.shift();
      if (next === undefined) return;
      take(next);
    }
  }

  const unsubscribe = inner.onTurn((event) => {
    if (closed) return;
    if (judging !== null) {
      queued.push(event);
      return;
    }
    take(event);
  });

  return {
    push(speakerId, pcm) {
      inner.push(speakerId, pcm);
    },
    onTurn(listener) {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at !== -1) listeners.splice(at, 1);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      if (judging !== null) settled(judging);
      queued.length = 0;
      listeners.length = 0;
      unsubscribe();
      inner.close();
    },
  };
}
