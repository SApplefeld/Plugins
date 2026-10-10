// The voice channel's speaker: 48 kHz 16-bit mono PCM in, one Opus packet out every 20 ms.
//
// The player keeps its own clock and hands each packet to the voice connection directly, rather
// than feeding a library audio player through a stream. A stream buffers frames ahead of the wire,
// and a buffered frame is one `stop()` cannot reach; here the queue is the only buffer, so a stop
// takes effect at the next tick and at most the frame already sent is heard.
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
  /** Frames waiting to be sent, a held part frame counted as one. */
  queued: () => number;
  /** Stops for good and frees the encoder. */
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
    const frame = paused ? null : next();
    if (frame !== null) {
      speak(true);
      trailer = SILENCE_FRAMES;
      let packet: Buffer | null = null;
      try {
        packet = encoder.encode(toStereo(frame), FRAME_SAMPLES);
      } catch (error) {
        log(`voice: encoding an audio frame failed: ${String(error)}`);
      }
      if (packet !== null) send(packet);
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
      if (frames.length > 0 || partial.length > 0) arm();
    },
    queued: () => frames.length + (partial.length > 0 ? 1 : 0),
    close() {
      if (closed) return;
      closed = true;
      frames.length = 0;
      partial = Buffer.alloc(0);
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
