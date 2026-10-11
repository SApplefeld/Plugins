// Deepgram Flux text-to-speech behind `Speaker`: one WebSocket to `/v2/speak`, opened by the first
// `speak` after a join or after an idle close, carrying each reply as one turn, `Speak` then `Flush`,
// and answered by binary frames of 16-bit mono PCM at 48 kHz, which go to the player as they
// arrive. So the first words are heard while the rest of the reply is still being generated. One
// turn is on the socket at a time: the next call's turn goes once the previous turn has ended,
// which is the queue `Speaker` promises.
//
// The socket is closed by the client forty-five seconds after the last turn ended with no new
// call, under Deepgram's own sixty-second close of a client that sends nothing, so the next reply
// opens a fresh socket rather than racing a server close. Flux takes no history and no audio: its
// state across turns is its own prior generations on the connection.
//
// A failure here never reaches the caller as a throw, and never drops the text: a call that times
// out, meets an `Error`, a close or an open that fails ends that reply's speech, drops the socket,
// and hands the whole text to `fallback`, which posts it to the thread. Posts run one at a time in
// reply order while each settles within the timeout. A post still running at the timeout is given
// up on, so a hung post cannot keep later answers from the fallback, and it may then land after a
// later one. An outage is logged once and its end once.
//
// Nothing this file logs carries the key, the text or a server message body: a failure is logged
// by its kind or the server's code alone.
import type { FluxSocket } from "./flux.ts";
import { SAMPLE_RATE } from "./player.ts";
import type { Player } from "./player.ts";
import type { Speaker } from "./speaker.ts";
import { spokenForm } from "./spoken-form.ts";

/** The one host the text is ever sent to. A constant, so no setting can redirect it. */
export const FLUX_SPEECH_URL = "wss://api.deepgram.com/v2/speak";
/**
 * How long a socket stays open with no turn on it before the client closes it. Under Deepgram's
 * sixty-second close of an idle client (`NET-0004`), so the close is always the client's own.
 */
export const IDLE_CLOSE_MS = 45_000;

/**
 * Opens a socket to `url` with `headers` on the handshake. The transcriber's opener shape, extended
 * with `onAudio` for the binary frames the speech socket answers with. `onClose` fires at most once,
 * when the socket closes or fails, with a detail fit for the log.
 */
export type OpenSpeechSocket = (input: {
  url: string;
  headers: Record<string, string>;
  onOpen: () => void;
  onMessage: (text: string) => void;
  onAudio: (pcm: Buffer) => void;
  onClose: (detail: string) => void;
}) => FluxSocket;

/** Opens through Node's own WebSocket client, which sends the handshake headers it is given. */
export const openWithWebSocket: OpenSpeechSocket = ({ url, headers, onOpen, onMessage, onAudio, onClose }) => {
  const socket = new WebSocket(url, { headers });
  socket.binaryType = "arraybuffer";
  let finished = false;
  const finish = (detail: string): void => {
    if (finished) return;
    finished = true;
    onClose(detail);
  };
  socket.addEventListener("open", () => onOpen());
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") onMessage(event.data);
    else if (event.data instanceof ArrayBuffer) onAudio(Buffer.from(event.data));
  });
  socket.addEventListener("error", () => finish("the socket failed"));
  socket.addEventListener("close", (event) => finish(`the socket closed with code ${String(event.code)}`));
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(1000),
  };
};

/** The speech URL for `voice`: the model and the player's own format. The key rides the handshake header, never the URL. */
export function speechSocketUrl(voice: string): string {
  const params = new URLSearchParams({ model: voice, encoding: "linear16", sample_rate: String(SAMPLE_RATE) });
  return `${FLUX_SPEECH_URL}?${params.toString()}`;
}

export type FluxSpeechOptions = {
  /** The Deepgram key. Sent on the handshake and nowhere else. */
  key: string;
  /** The Flux voice, sent as the socket's `model`. */
  voice: string;
  /**
   * How long each wait may run before the call counts as unanswered: the open to `Connected`, the
   * `Flush` to the first frame, one frame to the next, and the last frame to the turn's end.
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

const POST_FAILED = "voice: posting an unspoken answer to the thread failed";

/** Text with at least one letter or digit, in any script: the least Deepgram can voice. */
const UTTERABLE = /[\p{L}\p{N}]/u;

/** How one call ended: spoken, cancelled, or the failure kind the log names. */
type Outcome = { kind: "spoken" } | { kind: "cancelled" } | { kind: "failed"; detail: string };

/**
 * The turn on the socket: the call it belongs to until that call settles, and then, after a cancel,
 * the frames and messages still to be consumed and dropped until its terminal message.
 */
type Turn = {
  /** Set by a cancel: every frame and message from then on is dropped. */
  cancelled: boolean;
  /** An odd trailing byte of the last frame, so a sample split across two frames is never shifted. */
  carry: Buffer;
  timer: NodeJS.Timeout | null;
  /** Settles the call, once; a later outcome is nobody's news. */
  settle: (outcome: Outcome) => void;
  /** Resolves once the turn has left the socket, which the next call waits on. */
  done: Promise<void>;
  finish: () => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A server-sent code as the log carries it: printable ASCII alone, cut to eighty characters. */
function codeOf(message: Record<string, unknown>): string {
  return typeof message.code === "string" ? message.code.replace(/[^\x20-\x7e]/g, "").slice(0, 80) : "no code";
}

export function createFluxSpeech(options: FluxSpeechOptions): Speaker {
  const open = options.open ?? openWithWebSocket;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const url = speechSocketUrl(options.voice);
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
  let socket: FluxSocket | null = null;
  // Whether the current socket has answered `Connected`; false while an open is pending.
  let connected = false;
  // The turn on the socket, or null between turns.
  let turn: Turn | null = null;
  let idle: NodeJS.Timeout | null = null;
  // Set by the first failure of an outage and cleared by the next spoken call, so each outage and
  // each recovery is logged once.
  let outage = false;

  function stopIdle(): void {
    if (idle !== null) clearTimer(idle);
    idle = null;
  }

  /** Drops the socket without a word to the server, as after a failure, or after `Close` on an idle one. */
  function drop(graceful: boolean): void {
    stopIdle();
    const held = socket;
    socket = null;
    connected = false;
    sockets += 1;
    if (held === null) return;
    try {
      if (graceful) held.send(JSON.stringify({ type: "Close" }));
    } catch {
      // A socket that cannot take the request is already closing.
    }
    try {
      held.close();
    } catch {
      // A socket already closed has nothing left to close.
    }
  }

  /** Restarts the idle clock: with no new turn before it fires, the client closes the socket. */
  function restIdle(): void {
    stopIdle();
    idle = setTimer(() => {
      idle = null;
      if (turn === null) drop(true);
    }, IDLE_CLOSE_MS);
  }

  /** Re-arms the turn's one timer, which covers each wait in turn. */
  function arm(current: Turn): void {
    if (current.timer !== null) clearTimer(current.timer);
    current.timer = setTimer(() => {
      current.timer = null;
      // The wait ran out: the call fails and the socket goes. For a cancelled turn whose terminal
      // message never came the call settled at the cancel, so the socket goes with no log and no
      // fallback, and the next call opens a new one.
      end(current, { kind: "failed", detail: `did not answer within ${String(options.timeoutMs)}ms` }, false);
    }, options.timeoutMs);
  }

  /**
   * Ends the turn: settles its call, where that is still pending, and takes it off the socket. A
   * turn that ended well leaves the socket open with the idle clock running; any other drops it.
   */
  function end(current: Turn, outcome: Outcome, keepSocket: boolean): void {
    if (current.timer !== null) clearTimer(current.timer);
    current.timer = null;
    current.settle(current.cancelled ? { kind: "cancelled" } : outcome);
    if (turn === current) turn = null;
    if (keepSocket) restIdle();
    else drop(false);
    current.finish();
  }

  function onAudio(pcm: Buffer): void {
    const current = turn;
    if (current === null) return;
    // A cancelled turn's frames restart no wait: its one timeout runs from the cancel, so a server
    // that streams on past the `Interrupt` holds the next call for the timeout at most.
    if (current.cancelled) return;
    arm(current);
    let joined = current.carry.length === 0 ? pcm : Buffer.concat([current.carry, pcm]);
    if (joined.length % 2 === 1) {
      current.carry = Buffer.from(joined.subarray(joined.length - 1));
      joined = joined.subarray(0, joined.length - 1);
    } else {
      current.carry = Buffer.alloc(0);
    }
    if (joined.length > 0) options.player.play(joined);
  }

  /**
   * Handles one server message. `onConnected` is the open's settle, and `onRefused` its failure,
   * for an `Error` that arrives in place of `Connected`.
   */
  function receive(text: string, onConnected: () => void, onRefused: (detail: string) => void): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    const current = turn;
    switch (message.type) {
      case "Connected":
        onConnected();
        return;
      case "SpeechMetadata":
      case "SpeechInterrupted":
        // The turn's terminal message: `SpeechMetadata` once all of its audio has been sent, or
        // `SpeechInterrupted` in its place after an `Interrupt` the server acted on. A byte still
        // carried is not half a sample worth playing.
        if (current !== null) end(current, { kind: "spoken" }, true);
        return;
      case "Warning":
        // A turn of nothing but whitespace or punctuation produces no audio: the words go to the
        // thread instead. Every other warning leaves synthesis running and is nothing to act on,
        // the server's answer to an `Interrupt` it could not act on among them.
        if (current !== null && !current.cancelled && codeOf(message) === "NO_SYNTHESIZABLE_TEXT") {
          end(current, { kind: "failed", detail: `reported a warning, ${codeOf(message)}` }, false);
        }
        return;
      case "Error": {
        // Fatal, and followed by a close: the socket is dropped here, so that close ends nothing.
        // Before `Connected` it fails the open, with a turn it fails that call, and between turns
        // it drops the socket alone.
        const detail = `reported an error, ${codeOf(message)}`;
        if (current !== null) end(current, { kind: "failed", detail }, false);
        else if (!connected) onRefused(detail);
        else drop(false);
        return;
      }
      default:
        // `SpeechStarted`, `Flushed` and `SessionMetadata` carry nothing the client acts on.
        return;
    }
  }

  /**
   * Opens a socket and waits for `Connected`. Answers null, or the failure detail. Every way out
   * settles: an open left unsettled would hold the queue, and with it every later reply.
   */
  function connect(): Promise<string | null> {
    return new Promise((resolve) => {
      sockets += 1;
      connected = false;
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
        drop(false);
        settle(detail);
      };
      timer = setTimer(() => {
        timer = null;
        if (current()) drop(false);
        settle(`did not answer within ${String(options.timeoutMs)}ms`);
      }, options.timeoutMs);
      try {
        const opened = open({
          url,
          headers: { Authorization: `Token ${options.key}` },
          onOpen: () => {},
          onMessage: (text) => {
            if (!current()) return;
            receive(
              text,
              () => {
                connected = true;
                restIdle();
                settle(null);
              },
              fail,
            );
          },
          onAudio: (pcm) => {
            if (current()) onAudio(pcm);
          },
          onClose: (detail) => {
            if (!current()) return;
            // A close before `Connected` fails the open; one with a turn on the socket fails that
            // call; one between turns is nothing to log, and leaves no live socket.
            if (!settled) {
              fail(detail);
              return;
            }
            const held = turn;
            if (held !== null) end(held, { kind: "failed", detail }, false);
            else drop(false);
          },
        });
        if (current() && !gone) socket = opened;
      } catch {
        // The error is not logged: its message can carry the address.
        if (!gone && current()) fail("could not be reached");
      }
    });
  }

  /** Sends the text as one turn and settles when that turn has ended, or at a cancel. */
  function speakTurn(text: string, mine: number): Promise<Outcome> {
    return new Promise((resolve) => {
      let settled = false;
      let finish: () => void = () => {};
      const current: Turn = {
        cancelled: false,
        carry: Buffer.alloc(0),
        timer: null,
        settle: (outcome) => {
          if (settled) return;
          settled = true;
          resolve(outcome);
        },
        done: new Promise<void>((done) => {
          finish = done;
        }),
        finish: () => finish(),
      };
      if (mine !== generation) {
        current.settle({ kind: "cancelled" });
        current.finish();
        return;
      }
      if (socket === null) {
        // The socket went between `Connected` and this turn: the call fails, so the words reach
        // the thread rather than going nowhere.
        current.settle({ kind: "failed", detail: "the socket closed before the turn" });
        current.finish();
        return;
      }
      turn = current;
      stopIdle();
      arm(current);
      try {
        socket.send(JSON.stringify({ type: "Speak", text }));
        socket.send(JSON.stringify({ type: "Flush" }));
      } catch {
        // A socket that cannot take the turn is closing under the client: the call fails here, and
        // the close that follows finds no turn on the socket.
        end(current, { kind: "failed", detail: "could not take the turn" }, false);
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
   * Speaks one call: opens the socket where none is live, sends the turn and waits for its end.
   * `inThread` says the text already reaches the thread by another route, so a failure ends the
   * speech and logs the outage but hands nothing to the fallback, which would post a second copy.
   */
  async function run(text: string, mine: number, inThread: boolean): Promise<void> {
    // A cancelled turn may still be draining on the socket: its frames and messages are dropped
    // until its terminal message, and this call's turn goes only after, so the two never interleave.
    if (turn !== null) await turn.done;
    if (mine !== generation) return;
    let outcome: Outcome;
    if (socket === null) {
      const failure = await connect();
      // A call cancelled while its socket was opening sends nothing; the idle clock, started at
      // `Connected`, closes the socket on time.
      outcome =
        failure !== null ? { kind: "failed", detail: failure } : mine !== generation ? { kind: "cancelled" } : await speakTurn(text, mine);
    } else {
      outcome = await speakTurn(text, mine);
    }
    if (outcome.kind === "cancelled") return;
    if (outcome.kind === "spoken") {
      if (outage) {
        outage = false;
        options.log("voice: Deepgram speech answers again, so spoken answers are heard again");
      }
      return;
    }
    if (!outage) {
      outage = true;
      options.log(
        `voice: Deepgram speech ${outcome.detail}, so spoken answers go to the thread as text until it answers again`,
      );
    }
    if (inThread) return;
    // The spoken copy, whole: a turn has no segments, and without a playback offset the words
    // already heard cannot be told from the rest, so the thread may repeat a few and loses none.
    // This path runs only for a line not already in the thread, a fast answer or a holding line. A
    // fast answer's prompt asks for plain words, and where the mirror is off this spoken copy is
    // the one that reaches the thread. A session reply reaches the thread as written before its
    // speech is asked for, and `inThread` posts nothing for it. Queued on the posts chain rather
    // than awaited, so the speech behind this call never waits on a post, and each post waits for
    // the one before it to settle or time out. Replies reach the thread in order while posts settle
    // in time, and a hung post delays later ones by at most the timeout. A throw and a rejection
    // are caught alike, and the error is not logged, since its message can carry the text. The last
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
      // The spoken form is what Deepgram is sent and what the fallback posts, so the two agree.
      const spoken = spokenForm(text);
      // Nothing to say opens nothing and sends nothing: a reply with no letter or digit, such as
      // "?!" or "...", is one Deepgram answers with no audio and a warning, not a voice to wait for.
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
      if (current === null || current.cancelled) return;
      // The call settles now; the turn stays on the socket until its terminal message, which is
      // `SpeechInterrupted`, or `SpeechMetadata` where the server had no audio yet to interrupt.
      current.cancelled = true;
      current.carry = Buffer.alloc(0);
      current.settle({ kind: "cancelled" });
      // The drain's one bound: with no terminal message within the timeout of the cancel, the
      // socket goes and the next call opens a new one.
      arm(current);
      try {
        socket?.send(JSON.stringify({ type: "Interrupt" }));
      } catch {
        // A socket that cannot take the request is closing, and its close ends the turn.
      }
    },
  };
}
