// Inworld's streaming speech-to-text behind `Transcriber`: one bidirectional socket per joined
// channel, opened on join and closed on leave, carrying the operator's audio as LINEAR16 at 48 kHz
// mono and answering turn events. The key rides the handshake's `Authorization: Basic` header as
// Inworld's portal gives it, never the URL.
//
// Inworld finds the end of a turn itself, from the silence in the streamed audio, and Discord
// delivers frames only while someone speaks, so the socket is fed on a clock of its own: every
// 80 ms it sends the operator's queued frames, or one chunk of silence when none are queued. That
// keeps the stream continuous from join to leave, so Inworld hears every pause.
//
// The first message on a socket is the `transcribeConfig` greeting, then each chunk goes as a
// base64 `audioChunk`, and `closeStream` goes ahead of the close. An interim transcription is an
// `update`, the first of a turn preceded by a `start`, and a final one, `isFinal` set, is the
// turn's `end`. Inworld's voice-activity events are not surfaced, and no eager end or resumed turn
// is produced. The voice profile's top emotion rides the `end` as `tone` where Inworld is confident
// of it.
//
// A failure here never reaches the voice connection or the thread. A dropped or refused socket is
// retried with backoff for as long as the channel is joined, and the channel is deaf meanwhile.
//
// Nothing this file logs carries the key, a server body or the operator's words: turn events are
// logged by their number, their timing and a tone held to a fixed label shape alone, a server error
// by its numeric code alone, and a socket that fails to open by its error's name alone.
import { FRAME_BYTES, FRAME_MS, SAMPLE_RATE } from "./player.ts";
import type { Transcriber, TurnEvent } from "./transcriber.ts";

export const INWORLD_STT_URL = "wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional";
export const INWORLD_STT_MODEL = "inworld/inworld-stt-1";
/** The chunk the silence clock sends once per tick, short enough that Inworld hears a pause soon after it starts. */
export const CHUNK_MS = 80;
/** Bytes in one chunk: four 20 ms frames of 16-bit mono PCM at 48 kHz. */
export const CHUNK_BYTES = FRAME_BYTES * (CHUNK_MS / FRAME_MS);
/**
 * The most queued audio one tick sends, two chunks. A backlog drains at twice real time, so the lag
 * a late frame builds stays bounded, and what is past the cap waits for the next tick.
 */
export const MAX_SEND_BYTES = 2 * CHUNK_BYTES;
/**
 * The first reconnect delay, doubled after each failure up to the cap. It is reset by the first
 * message a socket answers with, which is the first sign its stream was accepted, and by a socket
 * that stayed open longer than the cap before it closed, since a drop after that long is a new
 * outage rather than the same one retried.
 */
export const RECONNECT_FIRST_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
/**
 * The confidence the voice profile's top emotion must reach to ride an `end` as its tone. Below it
 * the label is a guess the persona would read as fact, so the turn carries no tone.
 */
export const TONE_MIN_CONFIDENCE = 0.5;
/** The longest tone label the end log line and the turn's tone note carry as itself; a longer one is logged as `other` and gets no note. */
export const TONE_LABEL_MAX_CHARS = 32;
/** Lowercase letters and hyphens, starting with a letter, up to `TONE_LABEL_MAX_CHARS` in all. */
export const TONE_LABEL_SHAPE = new RegExp(`^[a-z][a-z-]{0,${String(TONE_LABEL_MAX_CHARS - 1)}}$`);
/**
 * Inworld's documented defaults for its voice-activity threshold and its longest silence inside a
 * turn, in milliseconds, sent rather than left to the server because its page says the server's
 * defaults can change. A threshold above zero keeps detection automatic.
 */
export const VAD_THRESHOLD = 0.05;
export const MAX_TURN_SILENCE_MS = 768;

/** The client's request to finalize the audio held and end the stream, sent before the close. */
const CLOSE_STREAM = JSON.stringify({ closeStream: {} });

/** The `audioChunk` message a tick with nothing queued sends: one chunk of zeroed PCM, built once. */
const SILENCE_CHUNK = JSON.stringify({ audioChunk: { content: Buffer.alloc(CHUNK_BYTES).toString("base64") } });

/** An open socket, reduced to the two calls this module makes. */
export type InworldSocket = {
  send: (data: string) => void;
  close: () => void;
};

/**
 * Opens a socket to `url` with `headers` on the handshake. `onClose` fires at most once, when the
 * socket closes or fails, with a detail fit for the log.
 */
export type OpenInworldSocket = (input: {
  url: string;
  headers: Record<string, string>;
  onOpen: () => void;
  onMessage: (text: string) => void;
  onClose: (detail: string) => void;
}) => InworldSocket;

/** Opens through Node's own WebSocket client, which sends the handshake headers it is given. */
export const openWithWebSocket: OpenInworldSocket = ({ url, headers, onOpen, onMessage, onClose }) => {
  const socket = new WebSocket(url, { headers });
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

export type InworldSettings = {
  /** Inworld's `endOfTurnConfidenceThreshold`, sent only where set; null leaves Inworld's own. */
  endOfTurnConfidenceThreshold: number | null;
};

/**
 * The greeting each socket opens with. Every value the adapter relies on is sent rather than left
 * to a default: the model, the encoding, the rate and channel count Discord delivers, and the voice
 * profile with the one label `tone` reads, and the voice-activity threshold and longest turn
 * silence under `inworldSttV1Config`. The end-of-turn threshold sits on `transcribeConfig` itself,
 * where Inworld reads it, and only where the setting is set. The minimum silence after a confident
 * end is left to Inworld, which states no default for it.
 */
export function inworldGreeting(settings: InworldSettings): string {
  return JSON.stringify({
    transcribeConfig: {
      modelId: INWORLD_STT_MODEL,
      audioEncoding: "LINEAR16",
      sampleRateHertz: SAMPLE_RATE,
      numberOfChannels: 1,
      voiceProfileConfig: { enableVoiceProfile: true, topN: 1 },
      ...(settings.endOfTurnConfidenceThreshold === null
        ? {}
        : { endOfTurnConfidenceThreshold: settings.endOfTurnConfidenceThreshold }),
      inworldSttV1Config: { vadThreshold: VAD_THRESHOLD, maxTurnSilence: MAX_TURN_SILENCE_MS },
    },
  });
}

export type InworldOptions = InworldSettings & {
  /** The Inworld key, as the portal gives it. Sent on the handshake and nowhere else. */
  key: string;
  open?: OpenInworldSocket;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  now?: () => number;
  log?: (message: string) => void;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The tone a voice profile reads as: its most confident emotion's label, where that confidence is
 * at least `TONE_MIN_CONFIDENCE`, else undefined. The label is held to printable ASCII, so a
 * server-sent label cannot carry a line break or a control character into the persona's text.
 */
export function toneOf(profile: unknown): string | undefined {
  if (!isRecord(profile) || !Array.isArray(profile.emotion)) return undefined;
  let top: { label: string; confidence: number } | null = null;
  for (const entry of profile.emotion as unknown[]) {
    if (!isRecord(entry) || typeof entry.label !== "string") continue;
    const confidence = entry.confidence;
    if (typeof confidence !== "number" || !Number.isFinite(confidence)) continue;
    const label = entry.label.replace(/[^\x20-\x7e]/g, "").trim().slice(0, 40);
    if (label === "") continue;
    if (top === null || confidence > top.confidence) top = { label, confidence };
  }
  return top !== null && top.confidence >= TONE_MIN_CONFIDENCE ? top.label : undefined;
}

/**
 * How the end log line names a turn's tone: `none` where there is none, the label itself where it
 * fits `TONE_LABEL_SHAPE`, and `other` for any other label, so a server-sent label cannot carry
 * arbitrary text into the log. The `end` event's own tone is not affected.
 */
function toneForLog(tone: string | undefined): string {
  if (tone === undefined) return "none";
  return TONE_LABEL_SHAPE.test(tone) ? tone : "other";
}

/** Opens the socket at once and keeps one open until `close`. */
export function createInworld(options: InworldOptions): Transcriber {
  const open = options.open ?? openWithWebSocket;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => {});
  const greeting = inworldGreeting(options);

  const listeners = new Set<(event: TurnEvent) => void>();
  let closed = false;
  // Each socket opened gets a generation, and a callback from any socket but the current one is
  // ignored, so a late close from a replaced socket schedules nothing.
  let generation = 0;
  let socket: InworldSocket | null = null;
  // True from the socket's open until it closes: audio is queued and sent only then.
  let live = false;
  // Set when the current socket has answered with its first message, which resets the backoff.
  let answered = false;
  let retry: NodeJS.Timeout | null = null;
  // Armed when a socket is opened and cleared at its open, its drop or the leave. A socket still
  // not open when it fires, after `RECONNECT_MAX_MS`, is closed and dropped, so the retry runs.
  let opening: NodeJS.Timeout | null = null;
  let delay = RECONNECT_FIRST_MS;
  // Set by the first failure of an outage and cleared by the next answering socket, so each outage
  // and each recovery is logged once.
  let deaf = false;

  const queue: Buffer[] = [];
  let clock: NodeJS.Timeout | null = null;
  // The clock is anchored at the open and each tick scheduled against it, so a late timer is caught
  // up on the next delay rather than stretching the stream.
  let anchor = 0;
  let ticks = 0;
  // When the current socket opened, for the backoff reset a long-lived socket earns at its close.
  let openedAt = 0;

  let lastSpeaker = "";
  let turnSpeaker = "";
  // When each account's latest frame was pushed, for the end line's delay.
  const lastFrameAt = new Map<string, number>();
  // The turn speaker's latest frame as of the turn's latest interim, which the end line measures
  // from, so frames pushed after the last words were heard do not shorten the delay it reports.
  // Undefined until a turn's first interim, and an end with none reads the speaker's latest frame.
  let turnFrameAt: number | undefined = undefined;
  // Inworld does not number turns, so the transcriber does, from zero for its whole life: a number
  // is never reused across a reconnect, and a consumer's record of one turn stays its own.
  let nextTurn = 0;
  // The turn a `start` was emitted for and no `end` has followed, which a drop then closes, and the
  // latest words heard in it, which that closing `end` carries as `heard`.
  let openTurn: number | null = null;
  let openText = "";
  // The latest voice profile heard since the last end, read where the final carries none, since
  // Inworld's pages do not say which messages carry it.
  let turnProfile: unknown = undefined;

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
   * What one tick sends: the queued frames as they are, up to `MAX_SEND_BYTES`, or `SILENCE_CHUNK`
   * when nothing is queued. A chunk whose frames are partly late is sent unpadded, with only the
   * frames that arrived. A tick with nothing queued sends silence, including one at which all of a
   * chunk's frames are late.
   */
  function nextChunk(): string {
    if (queue.length === 0) return SILENCE_CHUNK;
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
    return JSON.stringify({ audioChunk: { content: Buffer.concat(parts, size).toString("base64") } });
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
      socket.send(nextChunk());
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

  function stopOpening(): void {
    if (opening !== null) clearTimer(opening);
    opening = null;
  }

  function dropped(detail: string): void {
    stopOpening();
    // A socket open longer than the cap before it closed starts the backoff over. One refused or
    // closed sooner keeps it, so a server that accepts and then drops each socket is not hammered.
    const lasted = live && now() - openedAt > RECONNECT_MAX_MS;
    // A turn the drop cut off is closed with a lost `end` carrying the words Inworld had already
    // sent as `heard`, so a consumer holding on that turn is released on what was said rather than
    // left waiting on an `end` the lost socket will never send. Its `text` is empty: it has no final
    // text.
    if (openTurn !== null && !closed) {
      const turn = openTurn;
      const heard = openText;
      openTurn = null;
      openText = "";
      emit({ kind: "end", speakerId: turnSpeaker, turn, text: "", lost: true, heard });
    }
    turnProfile = undefined;
    turnFrameAt = undefined;
    socket = null;
    live = false;
    answered = false;
    stopClock();
    if (closed) return;
    if (!deaf) {
      deaf = true;
      log(
        `voice: transcription is unavailable (${detail}), so the voice channel is deaf until it ` +
          `reconnects; the thread keeps working, and the broker retries with backoff`,
      );
    }
    if (lasted) delay = RECONNECT_FIRST_MS;
    retry = setTimer(connect, delay);
    delay = Math.min(delay * 2, RECONNECT_MAX_MS);
  }

  /** Opens a turn on the account whose audio came last, as the turn's first words arrive. */
  function startTurn(): number {
    const turn = nextTurn;
    nextTurn += 1;
    turnSpeaker = lastSpeaker;
    openTurn = turn;
    openText = "";
    emit({ kind: "start", speakerId: turnSpeaker, turn });
    return turn;
  }

  function transcription(result: Record<string, unknown>, value: Record<string, unknown>): void {
    const text = typeof value.transcript === "string" ? value.transcript : "";
    // The message reference places the profile inside the transcription and the profile guide
    // beside it, so both are read.
    const profile = value.voiceProfile ?? value.voice_profile ?? result.voiceProfile ?? result.voice_profile;
    if (isRecord(profile)) turnProfile = profile;
    const final = value.isFinal === true || value.is_final === true;
    if (!final) {
      // An interim with no words yet opens nothing, so a turn starts on its first words.
      if (text === "") return;
      const turn = openTurn ?? startTurn();
      openText = text;
      turnFrameAt = lastFrameAt.get(turnSpeaker);
      emit({ kind: "update", speakerId: turnSpeaker, turn, text });
      return;
    }
    // A final with no transcript carries the words heard for its turn, and one with no turn open
    // and no words is nothing to report.
    if (openTurn === null && text === "") {
      turnProfile = undefined;
      return;
    }
    const turn = openTurn ?? startTurn();
    const words = text !== "" ? text : openText;
    const tone = toneOf(turnProfile);
    const at = turnFrameAt ?? lastFrameAt.get(turnSpeaker);
    openTurn = null;
    openText = "";
    turnProfile = undefined;
    turnFrameAt = undefined;
    if (at !== undefined) {
      log(
        `voice: transcription turn=${String(turn)} ended ${String(now() - at)} ms after the last frame ` +
          `tone=${toneForLog(tone)}`,
      );
    }
    emit({ kind: "end", speakerId: turnSpeaker, turn, text: words, ...(tone === undefined ? {} : { tone }) });
  }

  function receive(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message)) return;
    if (message.error !== undefined) {
      // The numeric code alone: the server's message can carry anything, the request included.
      const code = isRecord(message.error) ? message.error.code : undefined;
      log(
        typeof code === "number" && Number.isInteger(code)
          ? `voice: transcription reported an error, code ${String(code)}`
          : "voice: transcription reported an error",
      );
      return;
    }
    if (!answered) {
      answered = true;
      delay = RECONNECT_FIRST_MS;
      if (deaf) {
        deaf = false;
        log("voice: transcription reconnected, the voice channel hears again");
      }
    }
    const result = message.result;
    if (!isRecord(result)) return;
    if (isRecord(result.transcription)) {
      transcription(result, result.transcription);
      return;
    }
    // A profile on a message of its own is kept for the turn's end like one on an interim.
    const beside = result.voiceProfile ?? result.voice_profile;
    if (isRecord(beside)) turnProfile = beside;
  }

  function connect(): void {
    retry = null;
    if (closed) return;
    generation += 1;
    const mine = generation;
    // Set when this socket's close has run, which `open` may do before it returns, or when it was
    // abandoned for not opening in time. A gone socket's callbacks are ignored like a replaced one's.
    let gone = false;
    const current = (): boolean => mine === generation && !closed && !gone;
    try {
      const opened = open({
        url: INWORLD_STT_URL,
        headers: { Authorization: `Basic ${options.key}` },
        onOpen: () => {
          // The open event fires after `open` has returned, as WebSocket's does, so the socket is
          // held by then and the greeting goes ahead of any audio.
          if (!current() || socket === null) return;
          stopOpening();
          try {
            socket.send(greeting);
          } catch {
            // A socket that cannot take the greeting is closing, and its close schedules the retry.
          }
          live = true;
          anchor = now();
          openedAt = anchor;
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
      if (!current()) return;
      socket = opened;
      opening = setTimer(() => {
        opening = null;
        if (!current() || live) return;
        gone = true;
        try {
          opened.close();
        } catch {
          // A socket already closed has nothing left to close.
        }
        dropped(`the socket did not open within ${String(RECONNECT_MAX_MS / 1_000)} seconds`);
      }, RECONNECT_MAX_MS);
    } catch (error) {
      // An open that ran this socket's close before throwing has already been dropped once. The
      // error is logged by its name alone: its message can carry the handshake, the key included.
      const name = error instanceof Error ? error.name : "a non-error value";
      if (current()) dropped(`opening the socket failed with ${name}`);
    }
  }

  connect();

  return {
    push(speakerId, pcm) {
      if (closed) return;
      lastSpeaker = speakerId;
      lastFrameAt.set(speakerId, now());
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
      stopOpening();
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
