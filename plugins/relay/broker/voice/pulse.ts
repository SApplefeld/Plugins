// The waiting pulse: a soft tone made in code that the player sends while the main model works on a
// spoken hand-off and nothing is being said. The bridge sets it on the player as a fill source, and
// the player asks it for one frame at a time, from frame 0 at each start.
//
// Two sine tones, 196 Hz and 294 Hz, mixed 0.85 to 0.15, under a raised-cosine swell that is silent
// at each end of the period. Both tones start at phase zero at frame 0 and run on without a break,
// and the swell alone repeats, so no frame join and no period's turn carries a step.
import { FRAME_SAMPLES, SAMPLE_RATE } from "./player.ts";

/** The two notes and their shares of the mix. The shares sum to 1, so the peak is the volume. */
const LOW_HZ = 196;
const HIGH_HZ = 294;
const LOW_SHARE = 0.85;
const HIGH_SHARE = 0.15;
/** Full scale of a 16-bit sample. */
const FULL_SCALE = 32767;

/**
 * One 20 ms frame of 48 kHz 16-bit mono PCM: frame `index` of the pulse, counted from its start,
 * with a swell of `periodMs` and a peak of `volume` percent of full scale. Volume 0 is silence.
 */
export function pulseFrame(index: number, periodMs: number, volume: number): Buffer {
  const frame = Buffer.alloc(FRAME_SAMPLES * 2);
  if (volume <= 0) return frame;
  const peak = FULL_SCALE * (volume / 100);
  const period = Math.round((periodMs * SAMPLE_RATE) / 1000);
  const first = index * FRAME_SAMPLES;
  for (let at = 0; at < FRAME_SAMPLES; at += 1) {
    const sample = first + at;
    // Each phase is taken as a whole number of samples into its own cycle, so a long wait keeps the
    // precision of its first second.
    const swell = 0.5 - 0.5 * Math.cos((2 * Math.PI * (sample % period)) / period);
    const low = Math.sin((2 * Math.PI * ((sample * LOW_HZ) % SAMPLE_RATE)) / SAMPLE_RATE);
    const high = Math.sin((2 * Math.PI * ((sample * HIGH_HZ) % SAMPLE_RATE)) / SAMPLE_RATE);
    frame.writeInt16LE(Math.round(peak * swell * (LOW_SHARE * low + HIGH_SHARE * high)), at * 2);
  }
  return frame;
}
