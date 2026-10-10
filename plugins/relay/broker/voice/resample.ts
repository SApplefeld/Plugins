// 16-bit mono PCM at 24 kHz to the player's 48 kHz, by linear interpolation, fed one network chunk
// at a time, and the operator's 48 kHz back down to the speech service's 24 kHz.
//
// Each input sample is followed by the midpoint between it and the next one, so N samples in are
// exactly 2N out. The midpoint needs the next sample, so the last sample seen is held until the
// next chunk brings its neighbour, and a chunk may also end halfway through a sample. Splitting a
// stream anywhere therefore gives the same output as feeding it whole. At the end of the stream the
// held sample is written twice, since it has no neighbour to lean towards.

export type Resampler = {
  /** Takes the next chunk of 24 kHz little-endian 16-bit PCM and returns the 48 kHz PCM it completes. */
  push: (chunk: Uint8Array) => Buffer;
  /** Ends the stream: returns the held sample's two output samples. A trailing half sample is dropped. */
  end: () => Buffer;
};

/** Rounds to the nearest integer and clamps to the 16-bit sample range. */
function toSample(value: number): number {
  return Math.max(-32_768, Math.min(32_767, Math.round(value)));
}

export function createResampler(): Resampler {
  // The first byte of a sample the last chunk cut in half, or null.
  let odd: number | null = null;
  // The last whole sample read, whose midpoint waits for the next one.
  let held: number | null = null;

  return {
    push(chunk) {
      let bytes = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      if (odd !== null && bytes.length > 0) {
        bytes = Buffer.concat([Buffer.from([odd]), bytes]);
        odd = null;
      }
      const samples = Math.floor(bytes.length / 2);
      if (bytes.length % 2 === 1) odd = bytes[bytes.length - 1];
      // Every sample read completes the held one's pair, except the first of the stream.
      const pairs = held === null ? Math.max(0, samples - 1) : samples;
      const out = Buffer.alloc(pairs * 4);
      let written = 0;
      for (let index = 0; index < samples; index += 1) {
        const sample = bytes.readInt16LE(index * 2);
        if (held !== null) {
          out.writeInt16LE(held, written);
          out.writeInt16LE(toSample((held + sample) / 2), written + 2);
          written += 4;
        }
        held = sample;
      }
      return out;
    },
    end() {
      odd = null;
      if (held === null) return Buffer.alloc(0);
      const out = Buffer.alloc(4);
      out.writeInt16LE(held, 0);
      out.writeInt16LE(held, 2);
      held = null;
      return out;
    },
  };
}

export type Downsampler = {
  /** Takes the next chunk of 48 kHz little-endian 16-bit PCM and returns the 24 kHz PCM it completes. */
  push: (chunk: Uint8Array) => Buffer;
};

/**
 * 16-bit mono PCM at 48 kHz to 24 kHz: each pair of samples becomes their average, so 2N samples in
 * are exactly N out. A chunk may end halfway through a sample or a pair, and what it cut is held for
 * the next chunk, so splitting a stream anywhere gives the same output as feeding it whole. At the
 * end of the stream a sample with no partner and a trailing half sample are dropped.
 */
export function createDownsampler(): Downsampler {
  // The bytes the last chunk left short of a whole pair: none, or up to three.
  let carry = Buffer.alloc(0);
  return {
    push(chunk) {
      const bytes = Buffer.concat([carry, Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength)]);
      const pairs = Math.floor(bytes.length / 4);
      carry = Buffer.from(bytes.subarray(pairs * 4));
      const out = Buffer.alloc(pairs * 2);
      for (let index = 0; index < pairs; index += 1) {
        const average = (bytes.readInt16LE(index * 4) + bytes.readInt16LE(index * 4 + 2)) / 2;
        out.writeInt16LE(toSample(average), index * 2);
      }
      return out;
    },
  };
}

/** One whole buffer of 48 kHz PCM down to 24 kHz, under the downsampler's rules. */
export function downsample(pcm: Uint8Array): Buffer {
  return createDownsampler().push(pcm);
}
