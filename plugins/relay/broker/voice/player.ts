// The voice channel's speaker: 48 kHz 16-bit mono PCM in, one Opus packet out every 20 ms.
//
// The player keeps its own clock and hands each packet to the voice connection directly, rather
// than feeding a library audio player through a stream. A stream buffers frames ahead of the wire,
// and a buffered frame is one `stop()` cannot reach; here the queue is the only buffer, so a stop
// takes effect at the next tick and at most the frame already sent is heard.
//
// A fill source, the waiting pulse, plays on the same clock in the gaps speech leaves. It never
// passes through `play` and is never counted by `queued`, so speech alone is what the barge-in rule
// and the typing line read.
import OpusScript from "opusscript";

/** Discord's voice rate, and the only rate this player takes or sends. */
export const SAMPLE_RATE = 48_000;
/** One frame's length on the wire. */
export const FRAME_MS = 20;
/** Samples per channel in one frame. */
export const FRAME_SAMPLES = (SAMPLE_RATE / 1000) * FRAME_MS;
/** Bytes in one frame of 16-bit mono PCM, the unit `play` is cut into. */
export const FRAME_BYTES = FRAME_SAMPLES * 2;

/**
 * Discord's silence frame. Five are sent when audio stops, so the receiving clients' decoders
 * close the stream cleanly rather than interpolating the last frame.
 */
const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
const SILENCE_FRAMES = 5;

/**
 * One frame of 16-bit mono PCM from a fill source, by its index from the source's start. The player
 * asks for index 0 at each start and counts up while the source plays without a break.
 */
export type FillSource = (index: number) => Buffer;

/** What the player writes to: the voice connection's packet and speaking calls. */
export type OpusSink = {
  playOpusPacket: (packet: Buffer) => unknown;
  setSpeaking: (speaking: boolean) => unknown;
};

/** Encodes one frame of 16-bit stereo PCM to one Opus packet. */
export type OpusEncoder = {
  encode: (pcm: Buffer, frameSize: number) => Buffer;
  delete: () => void;
};

export type PlayerOptions = {
  sink: OpusSink;
  /** Defaults to a stereo `opusscript` encoder at 48 kHz, since Discord sends and plays stereo. */
  encoder?: OpusEncoder;
  /** Injected so a test fires each tick by hand. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  now?: () => number;
  log?: (message: string) => void;
};

export type Player = {
  /** Queues PCM, cut into 20 ms frames. A trailing part frame is padded with silence when reached. */
  play: (pcm: Buffer) => void;
  /** Discards everything queued. The frame already sent is the last one heard. */
  stop: () => void;
  /**
   * Holds the queue where it is. The silence trailer `stop` ends on is still sent, and then
   * nothing until `resume`.
   */
  pause: () => void;
  /** Continues from the frame `pause` held. */
  resume: () => void;
  /** Frames of speech waiting to be sent, a held part frame counted as one. A fill frame is not counted. */
  queued: () => number;
  /**
   * Sets the fill source, or clears it with null. A tick that finds no speech frame and no pause
   * sends the source's next frame. When speech arrives, a pause begins or the source is cleared,
   * the fill ends on one more frame faded to zero, and the next start is at its frame 0. A stop
   * leaves the source as it is.
   */
  fill: (source: FillSource | null) => void;
  /** Stops for good, clears the fill source and frees the encoder. */
  close: () => void;
};

/** One frame of mono PCM duplicated into both channels. */
export function toStereo(mono: Buffer): Buffer {
  const stereo = Buffer.alloc(mono.length * 2);
  for (let offset = 0; offset + 1 < mono.length; offset += 2) {
    const sample = mono.readInt16LE(offset);
    stereo.writeInt16LE(sample, offset * 2);
    stereo.writeInt16LE(sample, offset * 2 + 2);
  }
  return stereo;
}

/**
 * A copy of one frame of mono PCM scaled down to zero across its length, so its last sample is
 * silent.
 */
function fadeOut(frame: Buffer): Buffer {
  const faded = Buffer.alloc(FRAME_BYTES);
  const last = FRAME_SAMPLES - 1;
  for (let at = 0; at < FRAME_SAMPLES && at * 2 + 1 < frame.length; at += 1) {
    faded.writeInt16LE(Math.round((frame.readInt16LE(at * 2) * (last - at)) / last), at * 2);
  }
  return faded;
}

export function createPlayer(options: PlayerOptions): Player {
  const encoder =
    options.encoder ?? new OpusScript(SAMPLE_RATE, 2, OpusScript.Application.AUDIO);
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const now = options.now ?? Date.now;
  const log = options.log ?? ((): void => {});

  const frames: Buffer[] = [];
  let partial: Buffer = Buffer.alloc(0);
  let paused = false;
  let closed = false;
  let speaking = false;
  let trailer = 0;
  // The fill source as set, the one that sent the last frame while it is sounding, and the index of
  // the frame it sends next.
  let source: FillSource | null = null;
  let sounding: FillSource | null = null;
  let fillIndex = 0;
  let timer: NodeJS.Timeout | null = null;
  // The clock is anchored at the first tick of a run and each tick is scheduled against it, so a
  // late timer is caught up on the next delay rather than stretching the audio.
  let anchor = 0;
  let ticks = 0;

  function speak(on: boolean): void {
    if (speaking === on) return;
    speaking = on;
    try {
      options.sink.setSpeaking(on);
    } catch (error) {
      log(`voice: setting the speaking flag failed: ${String(error)}`);
    }
  }

  function send(packet: Buffer): void {
    try {
      options.sink.playOpusPacket(packet);
    } catch (error) {
      log(`voice: sending an audio packet failed: ${String(error)}`);
    }
  }

  function encodeAndSend(frame: Buffer): void {
    let packet: Buffer | null = null;
    try {
      packet = encoder.encode(toStereo(frame), FRAME_SAMPLES);
    } catch (error) {
      log(`voice: encoding an audio frame failed: ${String(error)}`);
    }
    if (packet !== null) send(packet);
  }

  /** Whether speech waits to be sent. */
  function hasSpeech(): boolean {
    return frames.length > 0 || partial.length > 0;
  }

  function next(): Buffer | null {
    const frame = frames.shift();
    if (frame !== undefined) return frame;
    if (partial.length === 0) return null;
    const padded = Buffer.alloc(FRAME_BYTES);
    partial.copy(padded);
    partial = Buffer.alloc(0);
    return padded;
  }

  function arm(): void {
    if (timer !== null || closed) return;
    // A paused player still ticks through its silence trailer, and then goes quiet.
    if (paused && trailer === 0) return;
    if (ticks === 0) anchor = now();
    const due = anchor + (ticks + 1) * FRAME_MS;
    timer = setTimer(tick, Math.max(0, due - now()));
  }

  function idle(): void {
    timer = null;
    ticks = 0;
  }

  function tick(): void {
    timer = null;
    if (closed) return;
    ticks += 1;
    // A fill that must give way, to speech, a pause or its own clearing, ends on one more frame
    // faded to zero, so it never stops on a step. Speech plays from the tick after.
    if (sounding !== null && (paused || hasSpeech() || source !== sounding)) {
      const faded = fadeOut(sounding(fillIndex));
      sounding = null;
      fillIndex = 0;
      trailer = SILENCE_FRAMES;
      encodeAndSend(faded);
      arm();
      return;
    }
    const frame = paused ? null : next();
    if (frame !== null) {
      speak(true);
      trailer = SILENCE_FRAMES;
      encodeAndSend(frame);
      arm();
      return;
    }
    if (!paused && source !== null) {
      speak(true);
      sounding = source;
      trailer = SILENCE_FRAMES;
      encodeAndSend(sounding(fillIndex));
      fillIndex += 1;
      arm();
      return;
    }
    if (trailer > 0) {
      trailer -= 1;
      send(SILENCE_FRAME);
      // The trailer's last frame is the end of the stream: the speaking flag drops with it.
      if (trailer > 0) {
        arm();
        return;
      }
    }
    speak(false);
    idle();
  }

  return {
    play(pcm) {
      if (closed || pcm.length === 0) return;
      let joined = partial.length === 0 ? pcm : Buffer.concat([partial, pcm]);
      while (joined.length >= FRAME_BYTES) {
        frames.push(joined.subarray(0, FRAME_BYTES));
        joined = joined.subarray(FRAME_BYTES);
      }
      partial = Buffer.from(joined);
      arm();
    },
    stop() {
      frames.length = 0;
      partial = Buffer.alloc(0);
      // The silence trailer still runs on the ticks that follow, so the clients close the stream.
    },
    pause() {
      if (paused || closed) return;
      // The ticks already running carry on through the silence trailer, so the clients close the
      // stream as they do on a stop, and the speaking flag drops after it.
      paused = true;
    },
    resume() {
      if (!paused || closed) return;
      paused = false;
      if (hasSpeech() || source !== null) arm();
    },
    queued: () => frames.length + (partial.length > 0 ? 1 : 0),
    fill(next) {
      if (closed) return;
      source = next;
      // A cleared source that is sounding is faded by the tick already running.
      if (source !== null && !paused) arm();
    },
    close() {
      if (closed) return;
      closed = true;
      frames.length = 0;
      partial = Buffer.alloc(0);
      source = null;
      sounding = null;
      if (timer !== null) clearTimer(timer);
      timer = null;
      speak(false);
      try {
        encoder.delete();
      } catch {
        // A freed encoder has nothing left to release.
      }
    },
  };
}
