// The turn hold: a `Transcriber` wrapped around the one Flux builds, so a thought the operator
// gathers across a pause reaches every consumer of turn events as one turn. An `end` with words is
// held rather than emitted, for up to the hold setting, and a new turn the same operator starts
// inside the wait joins the held words into one turn under the held turn's number. In the `judged`
// mode one Jev question is asked over the held words, and an answer that reads them as a finished
// thought releases the end at once; a doubtful answer, a failure of any kind, or the `plain` mode
// leaves the timer to release it.
//
// The wrapper keeps one listener list of its own, called in subscription order, so the turn-audio
// keeper, the barge-in rule and the bridge share one hold, one timer and one Jev call per end, and
// the barge-in rule still runs ahead of the bridge for every event.
//
// Nothing this file logs carries the operator's words: a hold's line names the turn number, how it
// ended and the numbers, and a Jev failure is logged by its kind alone through the repeat log.
import { createJevClient } from "../jev/client.ts";
import type { JevFetch, JevResult } from "../jev/client.ts";
import { COMPLETE_QUESTIONS, COMPLETE_REPEAT_LOG, completeState, isComplete } from "./complete.ts";
import type { CompleteQuestion } from "./complete.ts";
import type { Transcriber, TurnEvent } from "./transcriber.ts";

/** The hold's modes while it is built: `off` is not wired through it at all. */
export type TurnHoldMode = "plain" | "judged";

export type TurnHoldOptions = {
  mode: TurnHoldMode;
  /** `CHANNEL_VOICE_TURN_HOLD_MS`: how long a held end waits before the timer releases it. */
  holdMs: number;
  /** `CHANNEL_VOICE_COMPLETE_THRESHOLD`: the finished-thought probability that releases at once. */
  threshold: number;
  /**
   * The Jev key the hold's own client is built over, or null, which runs the hold plain whatever
   * the mode. The client is built here rather than taken built, since its results come back to
   * this hold alone. `fetch` is injected so a test drives the call without a network.
   */
  judge: { apiKey: string; fetch?: JevFetch } | null;
  log?: (message: string) => void;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  now?: () => number;
};

/** A held end: an `end` event with words, never a lost one. */
type HeldEnd = Extract<TurnEvent, { kind: "end"; lost?: undefined }>;

/**
 * One open hold. `end` is what is emitted on release, its text replaced by any update heard while
 * the hold is open. `answer` is Jev's finished-thought probability where it has answered and left
 * the timer to run, with the call's round trip, for the expiry line.
 */
type Hold = {
  end: HeldEnd;
  timer: NodeJS.Timeout;
  openedAt: number;
  answer: { probability: number; roundTripMs: number } | null;
};

/**
 * A continuation joined into a held turn: the inner transcriber's turn `from` is emitted as the
 * held turn `to`, under the held turn's account, with `prefix` ahead of each event's text. The
 * mapping outlives the hold that made it, so a resume or a late end of the joined turn still reads
 * as the held turn, and it ends at the next `start`, which is a turn of its own, or when the
 * continuation is lost, which releases `prefix` alone as the turn's end.
 */
type Joined = { from: number; to: number; speakerId: string; prefix: string };

/** The held text, one space and the continuation's text, trimmed. */
function join(prefix: string, text: string): string {
  return `${prefix} ${text}`.trim();
}

/**
 * Wraps `inner` in the hold. Subscribes to it once, at once, and emits to its own listeners.
 * `push` and `close` reach the inner transcriber; `close` first drops any held end unemitted and
 * clears its timer, since the channel is leaving and every consumer's leave drops its work.
 */
export function createTurnHold(inner: Transcriber, options: TurnHoldOptions): Transcriber {
  const log = options.log ?? ((): void => {});
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const now = options.now ?? Date.now;

  // In subscription order, which is the order each is called in for every event.
  const listeners: Array<(event: TurnEvent) => void> = [];
  let closed = false;
  let hold: Hold | null = null;
  let joined: Joined | null = null;
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

  /** Jev's numbers for the hold's line, where it answered. */
  function answered(held: Hold): string {
    return held.answer === null
      ? ""
      : `, jev=${held.answer.probability.toFixed(2)} in ${String(held.answer.roundTripMs)}ms`;
  }

  /** Ends the hold without emitting, for a join, a resume or the leave. */
  function drop(): Hold {
    const held = hold as Hold;
    clearTimer(held.timer);
    hold = null;
    return held;
  }

  /** Ends the hold and emits the held end as it stands, its `eager` flag included. */
  function release(how: string): void {
    const held = drop();
    log(`voice: turn hold turn=${String(held.end.turn)} ${how} after ${String(now() - held.openedAt)}ms${answered(held)}`);
    emit(held.end);
  }

  const judge =
    options.mode !== "judged" || options.judge === null
      ? null
      : createJevClient<CompleteQuestion, Hold>({
          apiKey: options.judge.apiKey,
          questions: COMPLETE_QUESTIONS,
          repeatLog: COMPLETE_REPEAT_LOG,
          ...(options.judge.fetch === undefined ? {} : { fetch: options.judge.fetch }),
          log,
          now,
          onResult: (_key, held, result: JevResult<CompleteQuestion>) => {
            // An answer for a hold that has closed, by a join, a resume, the timer or the leave, is
            // late and dropped. A failure is already on the repeat log by its kind, and leaves the
            // timer to run.
            if (held !== hold || !result.ok) return;
            held.answer = { probability: result.answers.complete, roundTripMs: now() - held.openedAt };
            if (isComplete(result, options.threshold)) release("released at once");
          },
        });

  function open(end: HeldEnd): void {
    const held: Hold = {
      end,
      timer: setTimer(() => {
        if (hold === held) release("released at expiry");
      }, options.holdMs),
      openedAt: now(),
      answer: null,
    };
    hold = held;
    if (judge === null) return;
    submissions += 1;
    judge.submit(`${String(end.turn)}/${String(submissions)}`, completeState(end.text), held);
  }

  /** The inner event as the consumers read it: a joined continuation reads as the held turn. */
  function mapped(event: TurnEvent): TurnEvent {
    if (joined === null || event.turn !== joined.from) return event;
    const { to: turn, speakerId, prefix } = joined;
    switch (event.kind) {
      case "update":
        return { kind: "update", speakerId, turn, text: join(prefix, event.text) };
      case "end":
        // A lost end of the joined turn never reaches here: `handle` releases the held words for it.
        return { kind: "end", speakerId, turn, text: join(prefix, event.text), ...(event.eager === true ? { eager: true as const } : {}) };
      default:
        return { ...event, speakerId, turn };
    }
  }

  function handle(received: TurnEvent): void {
    if (closed) return;
    if (joined !== null && received.kind === "end" && received.lost === true && received.turn === joined.from) {
      // The continuation is lost, so its words have no final text and are not answered, as a lost
      // turn's never are. The held words had already ended before the join, so they go on as the
      // held turn's finished end, with no eager flag, rather than being lost with the continuation.
      const { to: turn, speakerId, prefix } = joined;
      joined = null;
      log(`voice: turn hold turn=${String(turn)} released when the joined turn was lost`);
      emit({ kind: "end", speakerId, turn, text: prefix });
      return;
    }
    const event = mapped(received);
    switch (event.kind) {
      case "start": {
        // A new turn is its own unless it joins the one held: either way the earlier join is over.
        const held = hold;
        joined = null;
        if (held !== null) {
          if (event.speakerId === held.end.speakerId) {
            // The operator carrying on inside the wait: the held words and the new turn are one
            // turn, so nothing is emitted and the new turn reads as the held one from here on.
            joined = { from: received.turn, to: held.end.turn, speakerId: held.end.speakerId, prefix: held.end.text };
            drop();
            log(`voice: turn hold turn=${String(held.end.turn)} joined by the next turn after ${String(now() - held.openedAt)}ms${answered(held)}`);
            return;
          }
          // Another operator speaking ends the first one's thought.
          release("released by another speaker");
        }
        emit(event);
        return;
      }
      case "update":
        // Where an update of the held turn arrives while the hold is open, as it may after an eager
        // end that has not been resumed, its words replace the held text and the release carries
        // them, since no later end would.
        if (hold !== null && event.turn === hold.end.turn && event.text !== "") {
          hold.end = { ...hold.end, text: event.text };
        }
        emit(event);
        return;
      case "resumed":
        if (hold !== null && event.turn === hold.end.turn) {
          // The turn is still open as far as every consumer knows, so there is nothing to emit; its
          // next end opens a fresh hold.
          const held = drop();
          log(`voice: turn hold turn=${String(held.end.turn)} resumed after ${String(now() - held.openedAt)}ms${answered(held)}`);
          return;
        }
        emit(event);
        return;
      case "end":
        // Should an end arrive while one is held, the held end goes first, so no held end is
        // replaced or emitted out of order.
        if (hold !== null) release("released by the next end");
        if (event.lost === true || event.text === "") {
          // Nothing in it can be judged or joined.
          emit(event);
          return;
        }
        open(event);
        return;
      default:
        return;
    }
  }

  const unsubscribe = inner.onTurn(handle);

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
      if (hold !== null) drop();
      joined = null;
      listeners.length = 0;
      unsubscribe();
      inner.close();
    },
  };
}
