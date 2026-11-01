// Cartesia Sonic text-to-speech behind `Speaker`: one WebSocket to Cartesia's TTS endpoint, opened
// by the first `speak` after a join or after an idle close, carrying each reply as one context of
// its own, and answered by JSON chunks of base64 16-bit mono PCM at 48 kHz, which go to the player
// as they arrive. So the first words are heard while the rest of the reply is still being
// generated. One context is on the socket at a time: the next call's context goes once the previous
// one has ended, which is the queue `Speaker` promises.
//
// The socket is closed by the client forty-five seconds after the last context ended with no new
// call, so the next reply opens a fresh socket rather than meeting a close the server chose.
// Cartesia's reference states no idle timeout, and the client's own close keeps an unused socket
// from being held open for the life of the join.
//
// A cancel sends Cartesia's cancel for the context in flight and takes that context off the socket
// at once. Every later message carrying its id finds no context of its own and is dropped, so a
// late chunk never speaks over the next line, and the next call goes without waiting on the server.
//
// A failure here never reaches the caller as a throw, and never drops the text: a call that times
// out, meets an `error`, a close or an open that fails ends that reply's speech, drops the socket,
// and hands the whole text to `fallback`, which posts it to the thread. Posts run one at a time in
// reply order while each settles within the timeout. A post still running at the timeout is given
// up on, so a hung post cannot keep later answers from the fallback, and it may then land after a
// later one. An outage is logged once and its end once.
//
// Nothing this file logs carries the key, the text or a server message body: a failure is logged
// by its kind or the server's numeric status code alone.
import { randomUUID } from "node:crypto";
import { SAMPLE_RATE } from "./player.ts";
import type { Player } from "./player.ts";
import { openWithWebSocket } from "./socket.ts";
import type { OpenSpeechSocket } from "./socket.ts";
import type { Speaker } from "./speaker.ts";
import { spokenForm } from "./spoken-form.ts";

/** The one host the text is ever sent to. A constant, so no setting can redirect it. */
export const CARTESIA_SPEECH_URL = "wss://api.cartesia.ai/tts/websocket";
/**
 * The API version every request is made under. It rides the URL's `cartesia_version` query
 * parameter; Cartesia's API reference marks the version required and does not say whether it
 * belongs in the query or a header, so the query placement is an assumption.
 */
export const CARTESIA_VERSION = "2026-08-14";
/** The model each context is spoken by, the alias Cartesia points at its latest stable snapshot. */
export const CARTESIA_MODEL = "sonic-3.6";
/** How long a socket stays open with no context on it before the client closes it. */
export const IDLE_CLOSE_MS = 45_000;

/** The speech URL: the endpoint and the API version. The key rides the handshake header, never the URL. */
export function cartesiaSocketUrl(): string {
  const params = new URLSearchParams({ cartesia_version: CARTESIA_VERSION });
  return `${CARTESIA_SPEECH_URL}?${params.toString()}`;
}

export type CartesiaSpeechOptions = {
  /** The Cartesia key. Sent on the handshake and nowhere else. */
  key: string;
  /** The Cartesia voice id, sent as each context's `voice.id`. */
  voice: string;
  /**
   * How long each wait may run before the call counts as unanswered: the open, the request to the
   * first chunk, one chunk to the next, and the last chunk to the context's `done`.
   */
  timeoutMs: number;
  player: Pick<Player, "play" | "stop">;
  /**
   * Told the words a failure left unspoken, once per failed `speak`: the spoken form of the whole
   * text as handed, since without a playback offset the words already heard cannot be told apart.
   * The next post waits for this one to settle, or for `timeoutMs`, whichever comes first.
   */
  fallback: (text: string) => void | Promise<void>;
  log: (message: string) => void;
  /** Injected so a test can stand in for the network; the default is Node's WebSocket client. */
  open?: OpenSpeechSocket;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

type SpeechSocket = ReturnType<OpenSpeechSocket>;

const POST_FAILED = "voice: posting an unspoken answer to the thread failed";

/** Text with at least one letter or digit, in any script: the least worth sending to be voiced. */
const UTTERABLE = /[\p{L}\p{N}]/u;

/** How one call ended: spoken, cancelled, or the failure kind the log names. */
type Outcome = { kind: "spoken" } | { kind: "cancelled" } | { kind: "failed"; detail: string };

/** The context on the socket, from its request until it is done, fails or is cancelled. */
type Turn = {
  contextId: string;
  /** An odd trailing byte of the last chunk, so a sample split across two chunks is never shifted. */
  carry: Buffer;
  timer: NodeJS.Timeout | null;
  /** Settles the call, once; a later outcome is nobody's news. */
  settle: (outcome: Outcome) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether a server message names no context: its `context_id` is absent, null, empty or not a string. */
const namesNoContext = (message: Record<string, unknown>): boolean =>
  typeof message.context_id !== "string" || message.context_id === "";

/** A server error as the log carries it: its numeric status code alone, never its title or message. */
function errorDetail(message: Record<string, unknown>): string {
  const status = message.status_code;
  return typeof status === "number" && Number.isInteger(status)
    ? `reported an error, status ${String(status)}`
    : "reported an error";
}

export function createCartesiaSpeech(options: CartesiaSpeechOptions): Speaker {
  const open = options.open ?? openWithWebSocket;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const url = cartesiaSocketUrl();
  // Bumped by every `cancel`, so a call from before it can tell it was cancelled.
  let generation = 0;
  // The tail of the calls queued so far: each runs when the one before it has settled.
  let queue: Promise<void> = Promise.resolve();
  // The tail of the unspoken replies posted so far, a chain of its own: each post waits for the one
  // before it to settle or time out, and the speech queue waits on none of them.
  let posts: Promise<void> = Promise.resolve();
  // Each socket opened gets a generation, and a callback from any socket but the current one is
  // ignored, so a late close from a dropped socket ends nothing.
  let sockets = 0;
  let socket: SpeechSocket | null = null;
  // The context on the socket, or null between contexts and after a cancel.
  let turn: Turn | null = null;
  let idle: NodeJS.Timeout | null = null;
  // Set by the first failure of an outage and cleared by the next spoken call, so each outage and
  // each recovery is logged once.
  let outage = false;

  function stopIdle(): void {
    if (idle !== null) clearTimer(idle);
    idle = null;
  }

  /** Drops the socket without a word to the server: Cartesia has no close request of its own. */
  function drop(): void {
    stopIdle();
    const held = socket;
    socket = null;
    sockets += 1;
    if (held === null) return;
    try {
      held.close();
    } catch {
      // A socket already closed has nothing left to close.
    }
  }

  /** Restarts the idle clock: with no new context before it fires, the client closes the socket. */
  function restIdle(): void {
    stopIdle();
    idle = setTimer(() => {
      idle = null;
      if (turn === null) drop();
    }, IDLE_CLOSE_MS);
  }

  /** Re-arms the context's one timer, which covers each wait in turn. */
  function arm(current: Turn): void {
    if (current.timer !== null) clearTimer(current.timer);
    current.timer = setTimer(() => {
      current.timer = null;
      end(current, { kind: "failed", detail: `did not answer within ${String(options.timeoutMs)}ms` });
    }, options.timeoutMs);
  }

  /**
   * Ends the context: settles its call and takes it off the socket. A context that was spoken
   * leaves the socket open with the idle clock running; a failed one drops it.
   */
  function end(current: Turn, outcome: Outcome): void {
    if (current.timer !== null) clearTimer(current.timer);
    current.timer = null;
    if (turn === current) turn = null;
    if (outcome.kind === "failed") drop();
    else if (socket !== null) restIdle();
    current.settle(outcome);
  }

  function play(current: Turn, pcm: Buffer): void {
    let joined = current.carry.length === 0 ? pcm : Buffer.concat([current.carry, pcm]);
    if (joined.length % 2 === 1) {
      current.carry = Buffer.from(joined.subarray(joined.length - 1));
      joined = joined.subarray(0, joined.length - 1);
    } else {
      current.carry = Buffer.alloc(0);
    }
    if (joined.length > 0) options.player.play(joined);
  }

  /** Handles one server message for the context in flight; a message for any other context is dropped. */
  function receive(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    const current = turn;
    if (current === null) {
      // An error that names no context belongs to the socket: it goes, and the next call opens a
      // new one. Anything else between contexts, a cancelled context's late chunks among it, is
      // dropped.
      if (message.type === "error" && namesNoContext(message)) drop();
      return;
    }
    // An error that names no context is the context in flight's. Any other message naming no
    // context, a chunk among them, is dropped.
    const ours = message.context_id === current.contextId || (message.type === "error" && namesNoContext(message));
    if (!ours) return;
    switch (message.type) {
      case "chunk":
        if (typeof message.data === "string") {
          arm(current);
          play(current, Buffer.from(message.data, "base64"));
        }
        // A byte still carried at the end is not half a sample worth playing.
        if (message.done === true) end(current, { kind: "spoken" });
        return;
      case "done":
        end(current, { kind: "spoken" });
        return;
      case "error":
        end(current, { kind: "failed", detail: errorDetail(message) });
        return;
      default:
        // `timestamps` and `flush_done` carry nothing the client acts on.
        return;
    }
  }

  /**
   * Opens a socket and waits for it to open. Answers null, or the failure detail. Every way out
   * settles: an open left unsettled would hold the queue, and with it every later reply.
   */
  function connect(): Promise<string | null> {
    return new Promise((resolve) => {
      sockets += 1;
      const mine = sockets;
      const current = (): boolean => mine === sockets;
      let settled = false;
      let timer: NodeJS.Timeout | null = null;
      const settle = (detail: string | null): void => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimer(timer);
        resolve(detail);
      };
      // Set when this socket's close has run, which `open` may do before it returns.
      let gone = false;
      const fail = (detail: string): void => {
        gone = true;
        drop();
        settle(detail);
      };
      timer = setTimer(() => {
        timer = null;
        if (current()) drop();
        settle(`did not answer within ${String(options.timeoutMs)}ms`);
      }, options.timeoutMs);
      try {
        const opened = open({
          url,
          headers: { "X-API-Key": options.key },
          onOpen: () => {
            if (!current()) return;
            restIdle();
            settle(null);
          },
          onMessage: (text) => {
            if (current()) receive(text);
          },
          // Cartesia answers in JSON text alone, its audio base64 inside each chunk.
          onAudio: () => {},
          onClose: (detail) => {
            if (!current()) return;
            // A close before the open fails the open; one with a context on the socket fails that
            // call; one between contexts is nothing to log, and leaves no live socket.
            if (!settled) {
              fail(detail);
              return;
            }
            const held = turn;
            if (held !== null) end(held, { kind: "failed", detail });
            else drop();
          },
        });
        if (current() && !gone) socket = opened;
      } catch {
        // The error is not logged: its message can carry the address.
        if (!gone && current()) fail("could not be reached");
      }
    });
  }

  /** Sends the text as one context and settles when it is done, fails, or is cancelled. */
  function speakTurn(text: string, mine: number): Promise<Outcome> {
    return new Promise((resolve) => {
      if (mine !== generation) {
        resolve({ kind: "cancelled" });
        return;
      }
      if (socket === null) {
        // The socket went between its open and this context: the call fails, so the words reach
        // the thread rather than going nowhere.
        resolve({ kind: "failed", detail: "the socket closed before the turn" });
        return;
      }
      let settled = false;
      const current: Turn = {
        contextId: randomUUID(),
        carry: Buffer.alloc(0),
        timer: null,
        settle: (outcome) => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        },
      };
      turn = current;
      stopIdle();
      arm(current);
      try {
        socket.send(
          JSON.stringify({
            model_id: CARTESIA_MODEL,
            transcript: text,
            voice: { id: options.voice },
            language: "en",
            context_id: current.contextId,
            output_format: { container: "raw", encoding: "pcm_s16le", sample_rate: SAMPLE_RATE },
            continue: false,
          }),
        );
      } catch {
        // A socket that cannot take the context is closing under the client: the call fails here,
        // and the close that follows finds no context on the socket.
        end(current, { kind: "failed", detail: "could not take the turn" });
      }
    });
  }

  /**
   * Runs `post` and settles true when it settles, or false once `timeoutMs` has passed first. A
   * throw or a rejection from `post` rejects. The timer is cleared either way. A post given up on
   * is still logged when it settles, by a fixed line for a late landing or the failure line.
   */
  function withinTimeout(post: () => void | Promise<void>): Promise<boolean> {
    let timer: NodeJS.Timeout | null = null;
    const expired = new Promise<boolean>((resolve) => {
      timer = setTimer(() => resolve(false), options.timeoutMs);
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
        if (timer !== null) clearTimer(timer);
      });
  }

  /**
   * Speaks one call: opens the socket where none is live, sends the context and waits for its end.
   * `inThread` says the text already reaches the thread by another route, so a failure ends the
   * speech and logs the outage but hands nothing to the fallback, which would post a second copy.
   */
  async function run(text: string, mine: number, inThread: boolean): Promise<void> {
    if (mine !== generation) return;
    let outcome: Outcome;
    if (socket === null) {
      const failure = await connect();
      // A call cancelled while its socket was opening sends nothing; the idle clock, started at the
      // open, closes the socket on time.
      outcome =
        failure !== null ? { kind: "failed", detail: failure } : mine !== generation ? { kind: "cancelled" } : await speakTurn(text, mine);
    } else {
      outcome = await speakTurn(text, mine);
    }
    if (outcome.kind === "cancelled") return;
    if (outcome.kind === "spoken") {
      if (outage) {
        outage = false;
        options.log("voice: Cartesia speech answers again, so spoken answers are heard again");
      }
      return;
    }
    if (!outage) {
      outage = true;
      options.log(
        `voice: Cartesia speech ${outcome.detail}, so spoken answers go to the thread as text until it answers again`,
      );
    }
    if (inThread) return;
    // The spoken copy, whole: without a playback offset the words already heard cannot be told
    // from the rest, so the thread may repeat a few and loses none. This path runs only for a line
    // not already in the thread, a fast answer or a holding line; a session reply reaches the
    // thread as written before its speech is asked for, and `inThread` posts nothing for it. Queued
    // on the posts chain rather than awaited, so the speech behind this call never waits on a post,
    // and each post waits for the one before it to settle or time out. A throw and a rejection are
    // caught alike, and the error is not logged, since its message can carry the text. The last
    // catch keeps the chain from ever holding a rejection.
    posts = posts
      .then(() => withinTimeout(() => options.fallback(text)))
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
  }

  return {
    speak(text, speakOptions) {
      const mine = generation;
      const inThread = speakOptions?.inThread === true;
      // The spoken form is what Cartesia is sent and what the fallback posts, so the two agree.
      const spoken = spokenForm(text);
      // Nothing to say opens nothing and sends nothing: a reply with no letter or digit, such as
      // "?!" or "...", is no voice to wait for.
      if (!UTTERABLE.test(spoken)) return Promise.resolve();
      const next = queue.then(() => (mine === generation ? run(spoken, mine, inThread) : undefined));
      // `run` catches every failure it can meet, so the chain never holds a rejection.
      queue = next.catch(() => {});
      return queue;
    },
    cancel() {
      generation += 1;
      options.player.stop();
      const current = turn;
      if (current === null) return;
      // The call settles now and the context leaves the socket, so every later message carrying its
      // id finds no context of its own and is dropped. The socket stays for the next call.
      turn = null;
      if (current.timer !== null) clearTimer(current.timer);
      current.timer = null;
      current.carry = Buffer.alloc(0);
      try {
        socket?.send(JSON.stringify({ context_id: current.contextId, cancel: true }));
      } catch {
        // A socket that cannot take the request is closing, and the next call opens a new one.
      }
      if (socket !== null) restIdle();
      current.settle({ kind: "cancelled" });
    },
  };
}
