// The speech boundary: text in, 48 kHz 16-bit mono PCM out to the joined channel's player.
// Everything above this file speaks through `Speaker` alone, so the vendor behind it can change
// without anything above it changing. The speech service is the first implementation, in
// speech-service.ts.

/** One line of the spoken conversation: the operator's (`user`) or the persona's own. */
export type SpokenLine = { role: "user" | "persona"; text: string };

/** What one `speak` call says about its text beyond the words. */
export type SpeakOptions = {
  /**
   * The text already reaches the thread by another route, as a session reply does through the
   * outbound router, so a failure to speak it is not posted there a second time. Off by default:
   * a fast answer has no other way to the thread.
   */
  inThread?: boolean;
  /**
   * The operator's latest finished turn, its text and its 48 kHz 16-bit mono PCM, which the speech
   * service takes its delivery from. Absent where no turn audio is held.
   */
  turn?: SpokenTurn;
};

/** The operator's latest finished turn as the speaker is handed it. */
export type SpokenTurn = { text: string; audio: Buffer };

export type Speaker = {
  /**
   * Speaks `text` as segments, in order, with `history` as the conversation it answers. A call
   * made while another is speaking runs after it. Resolves once the last segment's audio has been
   * handed to the player, or once the call failed or was cancelled; never rejects.
   */
  speak: (text: string, history: readonly SpokenLine[], options?: SpeakOptions) => Promise<void>;
  /**
   * Aborts the request in flight, drops every queued segment and queued call, and empties the
   * player. What it discards is not spoken, and the fallback is not told of it; the line the bridge
   * posted to the thread before asking for the speech stands.
   */
  cancel: () => void;
};

/** The most words one segment carries, the speech service's own segment bound. */
export const MAX_SEGMENT_WORDS = 30;

/**
 * A word that ends a sentence: one ending in `.`, `!` or `?`, optionally followed by closing quotes
 * or brackets. Words are split on whitespace, so the end is always followed by whitespace or the
 * end of the text.
 */
const SENTENCE_END = /[.!?]["'\u201d\u2019)\]}]*$/;

/** One segment: its words joined by single spaces, and the offset its first word starts at. */
export type Segment = { text: string; start: number };

/**
 * Cuts `text` into the segments the speech service is sent, in order. Whole sentences are packed
 * greedily into a segment while it stays at or under `MAX_SEGMENT_WORDS` words. A sentence longer
 * than that is cut every `MAX_SEGMENT_WORDS` words, and each cut stands as a segment of its own.
 * Words are split on whitespace, the rule `wordCount` in transcriber.ts counts on, and joined by
 * single spaces. Each segment also carries the offset in `text` its first word starts at, so the
 * words a failure leaves unspoken can be posted from there. The speech service cuts its spoken copy,
 * so its fallback carries the spoken copy. Whitespace-only text has no segments.
 *
 * The rule mirrors the service's own, so the service never splits a segment it is sent.
 */
export function segmentsOf(text: string): Segment[] {
  type Word = { word: string; start: number };
  const sentences: Word[][] = [];
  let sentence: Word[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    sentence.push({ word: match[0], start: match.index });
    if (SENTENCE_END.test(match[0])) {
      sentences.push(sentence);
      sentence = [];
    }
  }
  if (sentence.length > 0) sentences.push(sentence);

  const segments: Segment[] = [];
  const emit = (words: readonly Word[]): void => {
    if (words.length === 0) return;
    segments.push({ text: words.map(({ word }) => word).join(" "), start: words[0].start });
  };
  let current: Word[] = [];
  for (const words of sentences) {
    if (words.length > MAX_SEGMENT_WORDS) {
      emit(current);
      current = [];
      for (let start = 0; start < words.length; start += MAX_SEGMENT_WORDS) {
        emit(words.slice(start, start + MAX_SEGMENT_WORDS));
      }
      continue;
    }
    if (current.length + words.length > MAX_SEGMENT_WORDS) {
      emit(current);
      current = [];
    }
    current.push(...words);
  }
  emit(current);
  return segments;
}
