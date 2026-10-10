// The transcription boundary: operator PCM in, turn events out. Everything above this file reads
// turns through `Transcriber` alone, so the vendor behind it can change without anything above it
// changing. Flux is the first implementation, in flux.ts.
//
// The barge-in rule lives here too, since it is the one consumer of turn events this layer owns:
// it is how the player yields the floor when the operator starts speaking.
import type { Player } from "./player.ts";

/**
 * One turn event, tagged with the account whose audio opened the turn and the vendor's turn index.
 * `end` carries the turn's final text. An `end` with `lost` set closes a turn the transcriber lost,
 * as when its connection drops mid-turn: it has no final text, so `text` is empty, and `heard`
 * holds the words transcribed before the loss, which may be none. A consumer that answers turns
 * skips an `end` with `lost` set, since it has no final text and `heard` may be a partial
 * transcript. `resumed` withdraws an `end` already emitted for the same turn, when the speaker
 * turned out not to have finished. An `end` with `eager` set is an early end, one a `resumed` may
 * still withdraw; with no resume behind it, it is the turn's only end, since the final end it ran
 * ahead of is never sent. An `end` without it is final.
 */
export type TurnEvent =
  | { kind: "start"; speakerId: string; turn: number }
  | { kind: "update"; speakerId: string; turn: number; text: string }
  | {
      kind: "end";
      speakerId: string;
      turn: number;
      text: string;
      eager?: true;
      lost?: undefined;
      heard?: undefined;
    }
  | { kind: "end"; speakerId: string; turn: number; text: ""; lost: true; heard: string; eager?: undefined }
  | { kind: "resumed"; speakerId: string; turn: number };

export type Transcriber = {
  /** Takes one frame of 48 kHz 16-bit mono PCM and the account it came from. */
  push: (speakerId: string, pcm: Buffer) => void;
  /** Calls `listener` with every turn event from now on. Returns the call that stops it. */
  onTurn: (listener: (event: TurnEvent) => void) => () => void;
  /** Stops transcribing for good: nothing is sent and no event fires after it returns. */
  close: () => void;
};

/** The number of words in a turn's text, counted on whitespace. */
export function wordCount(text: string): number {
  return text.split(/\s+/).filter((word) => word !== "").length;
}

/**
 * The barge-in rule's reading of a short turn over the persona's speech. `speaking` says whether
 * the persona is mid-reply: a speech handed to the speaker has not settled, or the player holds
 * frames. Both halves are needed, since a speak settles when its last frame reaches the player and
 * the player is empty in the gap before a segment's first frame arrives. `onHeldShort` is told the
 * number of a short turn that ended while it read true.
 */
export type HeldShortReading = {
  speaking: () => boolean;
  onHeldShort: (turn: number) => void;
};

/**
 * Binds the barge-in rule between a transcriber and the joined channel's player. An open turn holds
 * the floor: a turn that starts pauses the player whether or not speech is queued, so speech that
 * arrives during the operator's turn waits for that turn's end. When the turn ends with fewer than
 * `shortTurnWords` words, a cough or a "mm-hm", the player resumes; otherwise the queued speech is
 * discarded and `onDiscard` is called with that turn's number, which is where the speaker's request
 * in flight and the fast tier's work for the other turns are dropped; the number is what keeps the
 * cutting-in turn's own work, whichever listener took its end first. `onDiscard` is also told
 * whether the turn cut the persona short, `held.speaking()` read before the stop: a long turn after
 * the persona has finished is an ordinary turn, and what the persona said before it was heard. A
 * short turn that ends while the persona is mid-reply, `held.speaking()` reading true, is a
 * backchannel over the persona, and `held.onHeldShort` is called with its number, which is the one
 * reading of that judgment: the bridge posts such a turn and neither ranks nor hands it off, save
 * the end of an answer to an ASK the bridge holds, which is still that answer. A short
 * turn while the persona is silent is a turn of its own and is reported to neither. A `resumed` is
 * the speaker carrying on after an early `end`, so it is taken as a start: the player is paused
 * again, and the next `end` for the turn decides again. Returns the call that unbinds it.
 */
export function bindBargeIn(
  transcriber: Pick<Transcriber, "onTurn">,
  player: Pick<Player, "pause" | "resume" | "stop">,
  shortTurnWords: number,
  onDiscard?: (turn: number, cut: boolean) => void,
  held?: HeldShortReading,
): () => void {
  // Whether a turn has paused the player. Every `start` is followed by an `end` for the same turn,
  // a lost one where the transcriber lost the turn, so the next `end` releases the hold. A lost
  // `end` is counted on `heard`, the words transcribed before the loss, and any other on `text`.
  let holding = false;
  return transcriber.onTurn((event) => {
    if (event.kind === "start" || event.kind === "resumed") {
      if (!holding) {
        player.pause();
        holding = true;
      }
      return;
    }
    if (event.kind !== "end" || !holding) return;
    holding = false;
    if (wordCount(event.lost === true ? event.heard : event.text) < shortTurnWords) {
      // Read before the resume, while the turn still holds the floor. The listener runs before the
      // bridge's for this same end, since it subscribed first, so the reading is there when the
      // bridge takes the end.
      const midReply = held?.speaking() ?? false;
      player.resume();
      if (midReply) held?.onHeldShort(event.turn);
      return;
    }
    // Read before the stop empties the player: the one reading of whether the persona was still
    // speaking when this turn ended, which decides whether its last lines were heard through.
    const cut = held?.speaking() ?? false;
    player.stop();
    // A stopped player is still paused; resuming an empty queue clears the hold, so the next
    // speech plays.
    player.resume();
    onDiscard?.(event.turn, cut);
  });
}
