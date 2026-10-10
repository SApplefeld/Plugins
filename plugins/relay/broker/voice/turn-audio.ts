// The operator's turn audio: one joined channel's rolling window of the operator's 48 kHz 16-bit mono
// frames, and the cut of the latest finished turn, which the fast tier sends to the speech service so
// the persona takes its delivery from how the operator just spoke.
//
// The window holds the newest `seconds` of audio and nothing else, in process only: nothing here is
// written to disk or logged, and the voice's leave clears it. A turn's start marks the window half a
// second back, since the transcriber signals a start after speech has begun, though never before the
// last end, so a turn that follows close on another carries none of it; its end cuts the audio
// from that mark, capped at the window. A resume keeps the mark, so the resumed turn's later end
// carries the whole turn. Only the frames and turn events of the one operator the channel was joined
// for are kept.
import type { TurnEvent } from "./transcriber.ts";

/** How far before a turn's start its audio is cut from. */
export const PRE_ROLL_MS = 500;

/** 48 kHz of 16-bit mono samples. */
const BYTES_PER_SECOND = 48_000 * 2;

export type TurnAudio = {
  /** Takes one frame of 48 kHz 16-bit mono PCM and the account it came from. */
  push: (speakerId: string, pcm: Buffer) => void;
  /** Takes one turn event: a start marks, an end cuts, and the rest leave the mark as it is. */
  take: (event: TurnEvent) => void;
  /** The audio cut at turn `turn`'s end, or null where the latest cut is another turn's or none. */
  audioFor: (turn: number) => Buffer | null;
  /** Drops the window, the mark, the last end and the cut. */
  clear: () => void;
};

export function createTurnAudio(options: {
  /** How many seconds of audio the window holds. Zero holds nothing. */
  seconds: number;
  /** The operator whose frames and turns are kept. */
  speakerId: string;
  /** The clock frames are stamped on. Injected so a test moves time without waiting. */
  now?: () => number;
}): TurnAudio {
  const now = options.now ?? Date.now;
  const capacity = options.seconds * BYTES_PER_SECOND;
  // Frames are stamped on arrival and the mark is a time rather than a count of samples, because
  // Discord sends nothing while the operator is silent: half a second of samples back from a start
  // could reach across a pause into the last turn's audio, and half a second of time cannot.
  let frames: Array<{ at: number; pcm: Buffer }> = [];
  let held = 0;
  let mark: { turn: number; at: number } | null = null;
  let lastEnd: number | null = null;
  let cut: { turn: number; audio: Buffer } | null = null;

  return {
    push(speakerId, pcm) {
      if (capacity === 0 || speakerId !== options.speakerId) return;
      frames.push({ at: now(), pcm });
      held += pcm.length;
      // The oldest audio leaves first, cut inside a frame where that frame straddles the bound.
      while (held > capacity) {
        const oldest = frames[0];
        const excess = held - capacity;
        if (oldest.pcm.length <= excess) {
          frames.shift();
          held -= oldest.pcm.length;
        } else {
          oldest.pcm = oldest.pcm.subarray(excess);
          held -= excess;
        }
      }
    },
    take(event) {
      if (event.speakerId !== options.speakerId) return;
      if (event.kind === "start") {
        const back = now() - PRE_ROLL_MS;
        mark = { turn: event.turn, at: lastEnd === null ? back : Math.max(back, lastEnd) };
        return;
      }
      if (event.kind !== "end") return;
      const from = mark?.turn === event.turn ? mark.at : null;
      const kept = from === null ? [] : frames.filter((frame) => frame.at >= from).map((frame) => frame.pcm);
      cut = kept.length === 0 ? null : { turn: event.turn, audio: Buffer.concat(kept) };
      lastEnd = now();
    },
    audioFor: (turn) => (cut?.turn === turn ? cut.audio : null),
    clear() {
      frames = [];
      held = 0;
      mark = null;
      lastEnd = null;
      cut = null;
    },
  };
}
