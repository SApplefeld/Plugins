// The speech service behind `Speaker`: each segment of a reply is one `POST /v1/speak` to the
// service on the LAN, answered by a stream of 16-bit mono PCM at 24 kHz, which is resampled to
// 48 kHz and handed to the player as it arrives. So the first segment is heard while the later ones
// are still to be generated. A call that names the operator's latest turn sends it on every segment
// as the optional `turn` field, its audio halved to 24 kHz, cut to its last twenty seconds and
// base64-encoded; a call that names none sends the body without the key, as an older service expects.
//
// A failure here never reaches the caller as a throw, and never drops the text: a refused, failed or
// silent request ends that reply's speech, and the words not yet spoken are handed to `fallback`,
// which posts them to the thread. Posts run one at a time in reply order while each settles within
// the timeout. A post still running at the timeout is given up on, so a hung post cannot keep later
// answers from the fallback, and it may then land after a later one. An outage is logged once and
// its end once.
//
// Nothing this file logs carries the token, the service's address, the text, the turn's audio or a
// response body: a failure is logged by its status code or its kind alone.
import type { Player } from "./player.ts";
import { createResampler, downsample } from "./resample.ts";
import { segmentsOf } from "./speaker.ts";
import type { Speaker, SpokenLine } from "./speaker.ts";
import { spokenForm } from "./spoken-form.ts";

/**
 * The one request this module makes, as the narrowest shape a test fake needs to answer. The
 * global `fetch` satisfies it, and the default is that.
 */
export type SpeechFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    /** A redirect fails the request, so a 307 or 308 can never re-send the text to another host. */
    redirect: "error";
  },
) => Promise<{ ok: boolean; status: number; body: ReadableStream<Uint8Array> | null }>;

export type SpeechServiceOptions = {
  /** The service's base URL; requests go to `<url>/v1/speak`. */
  url: string;
  /** Sent as the bearer credential and never logged, in whole or in part. */
  token: string;
  /** The voice the service speaks in. */
  voice: string;
  /**
   * How long the service may take to answer a request, and how long it may then go quiet between
   * two chunks of audio, before the request counts as unanswered.
   */
  timeoutMs: number;
  player: Pick<Player, "play" | "stop">;
  /**
   * Told the words a failure left unspoken, once per failed `speak`: the spoken form of the text
   * as handed, from the first word of the segment that failed. The next call waits for this one to
   * settle, or for `timeoutMs`, whichever comes first, so calls keep reply order only while each
   * settles in time.
   */
  fallback: (text: string) => void | Promise<void>;
  log: (message: string) => void;
  /** Injected so a test can stand in for the network; the default is the global `fetch`. */
  fetch?: SpeechFetch;
};

const POST_FAILED = "voice: posting an unspoken answer to the thread failed";

/** How one segment's request ended: spoken, cancelled, or the failure kind the log names. */
type Outcome = { kind: "spoken" } | { kind: "cancelled" } | { kind: "failed"; detail: string };

/** The `turn` field as the service takes it: the text and base64 16-bit mono PCM at 24 kHz. */
type TurnField = { text: string; audio: string };

/** The most turn audio the service accepts, its own bound: twenty seconds of 24 kHz samples. */
const MAX_TURN_SAMPLES = 480_000;

export function createSpeechService(options: SpeechServiceOptions): Speaker {
  const request: SpeechFetch = options.fetch ?? globalThis.fetch;
  const endpoint = `${options.url.replace(/\/+$/, "")}/v1/speak`;
  // Bumped by every `cancel`, so a call or a stream from before it can tell it was cancelled.
  let generation = 0;
  // The tail of the calls queued so far: each runs when the one before it has settled.
  let queue: Promise<void> = Promise.resolve();
  // The tail of the unspoken replies posted so far, a chain of its own: each post waits for the one
  // before it to settle or time out, and the speech queue waits on none of them.
  let posts: Promise<void> = Promise.resolve();
  let inFlight: AbortController | null = null;
  // Set by the first failure of an outage and cleared by the next spoken segment, so each outage
  // and each recovery is logged once.
  let outage = false;

  async function speakSegment(
    text: string,
    history: readonly SpokenLine[],
    turn: TurnField | null,
    mine: number,
  ): Promise<Outcome> {
    const controller = new AbortController();
    inFlight = controller;
    let timedOut = false;
    let timer: NodeJS.Timeout | null = null;
    // One timer covers the wait for the response and then each wait for the next chunk.
    const arm = (): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs);
    };
    const resampler = createResampler();
    try {
      arm();
      const response = await request(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ voice: options.voice, history, text, ...(turn === null ? {} : { turn }) }),
        signal: controller.signal,
        redirect: "error",
      });
      if (!response.ok) {
        // The body is never read: it is the service's, and could quote the text back.
        controller.abort();
        return { kind: "failed", detail: `refused with status ${String(response.status)}` };
      }
      if (response.body !== null) {
        const reader = response.body.getReader();
        for (;;) {
          arm();
          const { done, value } = await reader.read();
          if (done) break;
          if (mine !== generation) return { kind: "cancelled" };
          const pcm = resampler.push(value);
          if (pcm.length > 0) options.player.play(pcm);
        }
      }
      // A cancel that landed on the read that ended the stream: the held sample is not played and
      // the segment does not count as spoken.
      if (mine !== generation) return { kind: "cancelled" };
      const last = resampler.end();
      if (last.length > 0) options.player.play(last);
      return { kind: "spoken" };
    } catch {
      // The error itself is not logged: a network error's message can carry the service's address.
      if (mine !== generation) return { kind: "cancelled" };
      return {
        kind: "failed",
        detail: timedOut ? `did not answer within ${String(options.timeoutMs)}ms` : "could not be reached",
      };
    } finally {
      if (timer !== null) clearTimeout(timer);
      if (inFlight === controller) inFlight = null;
    }
  }

  /**
   * Runs `post` and settles true when it settles, or false once `timeoutMs` has passed first. A
   * throw or a rejection from `post` rejects. The timer is cleared either way. A post given up on
   * is still logged when it settles, by a fixed line for a late landing or the failure line.
   */
  function withinTimeout(post: () => void | Promise<void>): Promise<boolean> {
    let timer: NodeJS.Timeout | null = null;
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), options.timeoutMs);
    });
    const settled = Promise.resolve()
      .then(post)
      .then(() => true);
    return Promise.race([settled, expired])
      .then((finished) => {
        if (!finished) {
          settled
            .then(
              () =>
                options.log(
                  "voice: an unspoken answer given up on reached the thread late, so it may sit after a later answer",
                ),
              () => options.log(POST_FAILED),
            )
            .catch(() => {});
        }
        return finished;
      })
      .finally(() => {
        if (timer !== null) clearTimeout(timer);
      });
  }

  /**
   * Speaks one call's segments in order. `inThread` says the text already reaches the thread by
   * another route, so a failure ends the speech and logs the outage but hands nothing to the
   * fallback, which would post a second copy.
   */
  async function run(
    text: string,
    history: readonly SpokenLine[],
    turn: TurnField | null,
    mine: number,
    inThread: boolean,
  ): Promise<void> {
    const segments = segmentsOf(text);
    for (let index = 0; index < segments.length; index += 1) {
      if (mine !== generation) return;
      const outcome = await speakSegment(segments[index].text, history, turn, mine);
      if (outcome.kind === "cancelled") return;
      if (outcome.kind === "spoken") {
        if (outage) {
          outage = false;
          options.log("voice: the speech service answers again, so spoken answers are heard again");
        }
        continue;
      }
      if (!outage) {
        outage = true;
        options.log(
          `voice: the speech service ${outcome.detail}, so spoken answers go to the thread as text ` +
            `until it answers again`,
        );
      }
      if (inThread) return;
      // The spoken copy from the failed segment on: the text the segments were cut from, which is
      // the spoken form of the line as handed. This path runs only for a line not already in the
      // thread, a fast answer or a holding line. A fast answer's prompt asks for plain words, and
      // where the mirror is off this spoken copy is the one that reaches the thread. A session
      // reply reaches the thread as written before its speech is asked for, and `inThread` posts
      // nothing for it. Queued on the posts chain rather than awaited, so the speech behind this
      // call never waits on a post, and each post waits for the one before it to settle or time
      // out. Replies reach the thread in order while posts settle in time, and a hung post delays
      // later ones by at most the timeout. A throw and a rejection are caught alike, and the error
      // is not logged, since its message can carry the text. The last catch keeps the chain from
      // ever holding a rejection.
      const unspoken = text.slice(segments[index].start);
      posts = posts
        .then(() => withinTimeout(() => options.fallback(unspoken)))
        .then(
          (finished) => {
            if (!finished) {
              options.log(
                `voice: posting an unspoken answer to the thread did not finish within ` +
                  `${String(options.timeoutMs)}ms, so later answers go on`,
              );
            }
          },
          () => options.log(POST_FAILED),
        )
        .catch(() => {});
      return;
    }
  }

  return {
    speak(text, history, options) {
      const mine = generation;
      // Taken now, in its spoken form: a caller's later change to its list does not reach this
      // call, and the caller's own lines stay as written.
      const lines = history.map(({ role, text: line }) => ({ role, text: spokenForm(line) }));
      const inThread = options?.inThread === true;
      // Encoded once per call, as handed, and sent with each of its segments. A longer turn is cut
      // to its tail, the words nearest the reply.
      let turn: TurnField | null = null;
      if (options?.turn !== undefined) {
        const audio = downsample(options.turn.audio);
        const tail = audio.subarray(Math.max(0, audio.length - MAX_TURN_SAMPLES * 2));
        turn = { text: options.turn.text, audio: tail.toString("base64") };
      }
      // The service is sent the spoken form, and the segments are cut from it, so the segment bound
      // holds on the words actually sent. The turn's text is a transcript, already words, and goes
      // as handed.
      const next = queue.then(() =>
        mine === generation ? run(spokenForm(text), lines, turn, mine, inThread) : undefined,
      );
      // `run` catches every failure it can meet, so the chain never holds a rejection.
      queue = next.catch(() => {});
      return queue;
    },
    cancel() {
      generation += 1;
      inFlight?.abort();
      inFlight = null;
      options.player.stop();
    },
  };
}
