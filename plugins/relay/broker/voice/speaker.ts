// The speech boundary: text in, 48 kHz 16-bit mono PCM out to the joined channel's player.
// Everything above this file speaks through `Speaker` alone, so the vendor behind it can change
// without anything above it changing. Deepgram Flux is the implementation, in flux-speech.ts.

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
};

export type Speaker = {
  /**
   * Speaks `text` as one turn. A call made while another is speaking runs after it. Resolves once
   * the turn's last audio has been handed to the player, or once the call failed or was cancelled;
   * never rejects.
   */
  speak: (text: string, options?: SpeakOptions) => Promise<void>;
  /**
   * Ends the turn in flight, drops every queued call, and empties the player. What it discards is
   * not spoken, and the fallback is not told of it; the line the bridge posted to the thread before
   * asking for the speech stands.
   */
  cancel: () => void;
};
