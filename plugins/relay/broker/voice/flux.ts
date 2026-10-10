// Deepgram Flux behind `Transcriber`: one streaming socket per joined channel, opened on join and
// closed on leave, carrying the operator's audio as linear16 at 48 kHz mono and answering turn
// events.
//
// Flux finds the end of a turn from audio time, and Discord delivers frames only while someone
// speaks, so the socket is fed on a clock of its own: every 80 ms it sends the operator's queued
// frames, or one chunk of silence when none are queued. That keeps the stream continuous from join
// to leave, which is also what Deepgram meters.
//
// A failure here never reaches the voice connection or the thread. A dropped or refused socket is
// retried with backoff for as long as the channel is joined, and the channel is deaf meanwhile.
//
// Nothing this file logs carries the key or the operator's words: turn events are never logged,
// and a server error is logged by its code alone.
import { FRAME_BYTES, FRAME_MS, SAMPLE_RATE } from "./player.ts";
import type { Transcriber, TurnEvent } from "./transcriber.ts";

export const FLUX_URL = "wss://api.deepgram.com/v2/listen";
export const FLUX_MODEL = "flux-general-en";
/** The chunk Flux recommends, sent once per tick of the silence clock. */
export const CHUNK_MS = 80;
/** Bytes in one chunk: four 20 ms frames of 16-bit mono PCM at 48 kHz. */
export const CHUNK_BYTES = FRAME_BYTES * (CHUNK_MS / FRAME_MS);
/**
 * The most queued audio one tick sends, two chunks. A backlog drains at twice real time, so the lag
 * a late frame builds stays bounded, and what is past the cap waits for the next tick.
 */
export const MAX_SEND_BYTES = 2 * CHUNK_BYTES;
/** The first reconnect delay, doubled after each failure up to the cap and reset on `Connected`. */
export const RECONNECT_FIRST_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

/** The client's request to flush and end the stream, sent before the socket is closed. */
const CLOSE_STREAM = JSON.stringify({ type: "CloseStream" });

/** An open socket, reduced to the two calls this module makes. */
export type FluxSocket = {
  send: (data: Uint8Array | string) => void;
  close: () => void;
};

/**
 * Opens a socket to `url` with `headers` on the handshake. `onClose` fires at most once, when the
 * socket closes or fails, with a detail fit for the log.
 */
export type OpenFluxSocket = (input: {
  url: string;
  headers: Record<string, string>;
  onOpen: () => void;
  onMessage: (text: string) => void;
  onClose: (detail: string) => void;
}) => FluxSocket;

/** Opens through Node's own WebSocket client, which sends the handshake headers it is given. */
export const openWithWebSocket: OpenFluxSocket = ({ url, headers, onOpen, onMessage, onClose }) => {
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
  });
  socket.addEventListener("error", () => finish("the socket failed"));
  socket.addEventListener("close", (event) => finish(`the socket closed with code ${String(event.code)}`));
  return {
    send: (data) => socket.send(data),
    close: () => socket.close(1000),
  };
};

export type FluxSettings = {
  /** Flux's `eot_threshold`. */
  eotThreshold: number;
  /** Flux's `eager_eot_threshold`, sent only when `eager` is on. */
  eagerThreshold: number;
  /** Whether an eager end of turn is surfaced as `end`. */
  eager: boolean;
};

/** The streaming URL for `settings`. The key rides the handshake header, never the URL. */
export function fluxUrl(settings: FluxSettings): string {
  const params = new URLSearchParams({
    model: FLUX_MODEL,
    encoding: "linear16",
    sample_rate: String(SAMPLE_RATE),
    eot_threshold: String(settings.eotThreshold),
  });
  // Flux sends eager events only when this parameter is present, so it is left off with eager off.
  if (settings.eager) params.set("eager_eot_threshold", String(settings.eagerThreshold));
  return `${FLUX_URL}?${params.toString()}`;
}

export type FluxOptions = FluxSettings & {
  /** The Deepgram key. Sent on the handshake and nowhere else. */
  key: string;
  open?: OpenFluxSocket;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  now?: () => number;
  log?: (message: string) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Opens the socket at once and keeps one open until `close`. */
export function createFlux(options: FluxOptions): Transcriber {
  const open = options.open ?? openWithWebSocket;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => {});
  const url = fluxUrl(options);

  const listeners = new Set<(event: TurnEvent) => void>();
  let closed = false;
  // Each socket opened gets a generation, and a callback from any socket but the current one is
  // ignored, so a late close from a replaced socket schedules nothing.
  let generation = 0;
  let socket: FluxSocket | null = null;
  // True from the socket's open until it closes: audio is queued and sent only then.
  let live = false;
  let retry: NodeJS.Timeout | null = null;
  let delay = RECONNECT_FIRST_MS;
  // Set by the first failure of an outage and cleared by the next `Connected`, so each outage and
  // each recovery is logged once.
  let deaf = false;

  const queue: Buffer[] = [];
  let clock: NodeJS.Timeout | null = null;
  // The clock is anchored at the open and each tick scheduled against it, so a late timer is caught
  // up on the next delay rather than stretching the stream.
  let anchor = 0;
  let ticks = 0;

  let lastSpeaker = "";
  let turnSpeaker = "";
  // The turn an eager `end` was emitted for, whose EndOfTurn is then suppressed.
  let eagerTurn: number | null = null;
  // The turn a `start` was emitted for and no `end` has followed, which a drop then closes, and the
  // latest words heard in the current turn, which that closing `end` carries as `heard`. The words
  // are kept across an eager `end`, so a turn the speaker resumes still holds them.
  let openTurn: number | null = null;
  let openText = "";
  // Flux numbers turns per socket, from zero, so a reconnect would reuse the numbers already
  // emitted. Each socket's indices are offset past the highest number emitted so far, which keeps
  // a turn number unique for the transcriber's life and a consumer's record of one turn its own.
  let turnOffset = 0;
  let highestTurn = -1;

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

  /**
   * What one tick sends: the queued frames as they are, up to `MAX_SEND_BYTES`, or one chunk of
   * silence when nothing is queued. A chunk whose frames are partly late is sent unpadded, with only
   * the frames that arrived. A tick with nothing queued sends silence, including one at which all of
   * a chunk's frames are late.
   */
  function chunk(): Buffer {
    if (queue.length === 0) return Buffer.alloc(CHUNK_BYTES);
    const parts: Buffer[] = [];
    let size = 0;
    while (size < MAX_SEND_BYTES && queue.length > 0) {
      const head = queue[0];
      const take = Math.min(head.length, MAX_SEND_BYTES - size);
      parts.push(head.subarray(0, take));
      size += take;
      if (take === head.length) queue.shift();
      else queue[0] = head.subarray(take);
    }
    return Buffer.concat(parts, size);
  }

  function arm(): void {
    const due = anchor + (ticks + 1) * CHUNK_MS;
    clock = setTimer(tick, Math.max(0, due - now()));
  }

  function tick(): void {
    clock = null;
    if (!live || closed || socket === null) return;
    ticks += 1;
    try {
      socket.send(chunk());
    } catch {
      // A socket that cannot send is closing, and its close event schedules the reconnect.
    }
    arm();
  }

  function stopClock(): void {
    if (clock !== null) clearTimer(clock);
    clock = null;
    queue.length = 0;
  }

  function dropped(detail: string): void {
    // A turn the drop cut off is closed with a lost `end` carrying the words Flux had already sent as
    // `heard`, so a consumer holding on that turn is released on what was said rather than left
    // waiting on an `end` the lost socket will never send. Its `text` is empty: it has no final text.
    if (openTurn !== null && !closed) {
      const turn = openTurn;
      const heard = openText;
      openTurn = null;
      openText = "";
      emit({ kind: "end", speakerId: turnSpeaker, turn, text: "", lost: true, heard });
    }
    socket = null;
    live = false;
    stopClock();
    eagerTurn = null;
    if (closed) return;
    if (!deaf) {
      deaf = true;
      log(
        `voice: transcription is unavailable (${detail}), so the voice channel is deaf until it ` +
          `reconnects; the thread keeps working, and the broker retries with backoff`,
      );
    }
    retry = setTimer(connect, delay);
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
  }

  function turnInfo(message: Record<string, unknown>): void {
    const turn = turnOffset + (typeof message.turn_index === "number" ? message.turn_index : 0);
    highestTurn = Math.max(highestTurn, turn);
    const text = typeof message.transcript === "string" ? message.transcript : "";
    switch (message.event) {
      case "StartOfTurn":
        turnSpeaker = lastSpeaker;
        eagerTurn = null;
        openTurn = turn;
        openText = "";
        emit({ kind: "start", speakerId: turnSpeaker, turn });
        return;
      case "Update":
        openText = text;
        emit({ kind: "update", speakerId: turnSpeaker, turn, text });
        return;
      case "EagerEndOfTurn":
        if (!options.eager) return;
        eagerTurn = turn;
        openTurn = null;
        // An eager end with no transcript leaves the words already heard in place, and the `end`
        // carries them, since the EndOfTurn behind it is suppressed and would not. A turn with no
        // words heard at all ends empty, which a consumer that answers turns skips. Marked eager, so a
        // consumer can tell it from the final end a resume would bring.
        if (text !== "") openText = text;
        emit({ kind: "end", speakerId: turnSpeaker, turn, text: openText, eager: true });
        return;
      case "TurnResumed":
        // Only an `end` already emitted has anything to withdraw.
        if (eagerTurn !== turn) return;
        eagerTurn = null;
        openTurn = turn;
        // The speaker carries on from the words already heard, or from the resume's own transcript
        // where it has one, so a drop before the next Update still closes the turn on them.
        if (text !== "") openText = text;
        emit({ kind: "resumed", speakerId: turnSpeaker, turn });
        return;
      case "EndOfTurn":
        // The eager `end` for this turn already carried it.
        if (eagerTurn === turn) {
          eagerTurn = null;
          openText = "";
          return;
        }
        {
          // An end of turn with no transcript carries the words heard for that turn, as the eager
          // end does.
          const final = text !== "" ? text : openTurn === turn ? openText : "";
          openTurn = null;
          openText = "";
          emit({ kind: "end", speakerId: turnSpeaker, turn, text: final });
        }
        return;
      default:
        return;
    }
  }

  function receive(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    switch (message.type) {
      case "Connected":
        delay = RECONNECT_FIRST_MS;
        if (deaf) {
          deaf = false;
          log("voice: transcription reconnected, the voice channel hears again");
        }
        return;
      case "TurnInfo":
        turnInfo(message);
        return;
      case "Error":
      case "Warning": {
        // Printable ASCII alone, so a server-sent code cannot break or forge a log line.
        const code =
          typeof message.code === "string" ? message.code.replace(/[^\x20-\x7e]/g, "").slice(0, 80) : "no code";
        log(`voice: transcription reported ${message.type === "Error" ? "an error" : "a warning"}, ${code}`);
        return;
      }
      default:
        return;
    }
  }

  function connect(): void {
    retry = null;
    if (closed) return;
    generation += 1;
    const mine = generation;
    const current = (): boolean => mine === generation && !closed;
    // This socket's turns are numbered past every turn the earlier sockets emitted.
    turnOffset = highestTurn + 1;
    // Set when this socket's close has run, which `open` may do before it returns.
    let gone = false;
    try {
      const opened = open({
        url,
        headers: { Authorization: `Token ${options.key}` },
        onOpen: () => {
          if (!current()) return;
          live = true;
          anchor = now();
          ticks = 0;
          arm();
        },
        onMessage: (text) => {
          if (current()) receive(text);
        },
        onClose: (detail) => {
          if (!current()) return;
          gone = true;
          dropped(detail);
        },
      });
      if (current() && !gone) socket = opened;
    } catch (error) {
      // An open that ran this socket's close before throwing has already been dropped once.
      if (!gone && current()) dropped(`opening the socket failed: ${String(error)}`);
    }
  }

  connect();

  return {
    push(speakerId, pcm) {
      if (closed) return;
      lastSpeaker = speakerId;
      if (live) queue.push(pcm);
    },
    onTurn(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      if (closed) return;
      closed = true;
      listeners.clear();
      if (retry !== null) clearTimer(retry);
      retry = null;
      stopClock();
      const held = socket;
      const wasLive = live;
      socket = null;
      live = false;
      if (held === null) return;
      try {
        if (wasLive) held.send(CLOSE_STREAM);
      } catch {
        // A socket that cannot take the request is already closing.
      }
      try {
        held.close();
      } catch {
        // A socket already closed has nothing left to close.
      }
    },
  };
}
