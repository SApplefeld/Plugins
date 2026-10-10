// The voice module's hooks for transcription: a transcriber built on each join and closed on each
// leave, fed every operator frame in between, with the barge-in rule bound to the joined channel's
// player and the bridge attached to both. The operator's turn audio is kept beside it, from the same
// frames, and cleared on the leave. Nothing transcription-related outlives the channel, so no audio
// leaves the machine while the bot is in none.
import type { VoiceFrame } from "./connection.ts";
import type { Player } from "./player.ts";
import { bindBargeIn } from "./transcriber.ts";
import type { Transcriber } from "./transcriber.ts";
import { createTurnAudio } from "./turn-audio.ts";
import type { TurnAudio } from "./turn-audio.ts";

/** What the join hook is told, as the voice connection tells it. */
export type JoinedSession = { player: Player; threadId: string; sessionId: string; senderId: string };

export type TranscriptionHooks = {
  onFrame: (frame: VoiceFrame) => void;
  onJoined: (session: JoinedSession) => void;
  onLeft: () => void;
};

/**
 * What `attach` hands back: the barge-in rule's discard, the two halves of its held-short-turn
 * reading where the bridge takes one (whether the persona is mid-reply, and the turn so read), and
 * the detach the leave runs.
 */
export type Attached = {
  /** A long turn ended; `cut` is whether it ended while the persona was still speaking. */
  onDiscard: (turn: number, cut: boolean) => void;
  speaking?: () => boolean;
  onHeldShort?: (turn: number) => void;
  detach: () => void;
};

export function transcriptionHooks(options: {
  /** The transcription key, or null to leave the channel deaf: then nothing is ever built. */
  key: string | null;
  /** The barge-in rule's short-turn bound, in words. */
  shortTurnWords: number;
  /** `CHANNEL_VOICE_TURN_AUDIO_SECONDS`: how much of the operator's turn is kept. Zero keeps none. */
  turnAudioSeconds: number;
  /** Builds a transcriber for one joined channel. */
  create: (key: string) => Transcriber;
  /**
   * Attaches the bridge for one joined channel to its transcriber and player, once the transcriber
   * exists. Its discard is the barge-in rule's, so a long cut-in reaches the bridge. One that throws
   * leaves the channel hearing with the barge-in rule bound and nothing attached. `turnAudio` reads
   * the operator's audio cut at a turn's end, or null, and holds it by the time any listener the
   * bridge subscribes is told of that end.
   */
  attach?: (
    session: JoinedSession & {
      transcriber: Pick<Transcriber, "onTurn">;
      turnAudio: (turn: number) => Buffer | null;
    },
  ) => Attached;
  log: (message: string) => void;
}): TranscriptionHooks {
  let transcriber: Transcriber | null = null;
  let attached: Attached | null = null;
  // The barge-in rule's unbind, run on the leave ahead of the transcriber's close.
  let unbind: (() => void) | null = null;
  let turnAudio: TurnAudio | null = null;
  let unbindAudio: (() => void) | null = null;
  return {
    onFrame: (frame) => {
      transcriber?.push(frame.userId, frame.pcm);
      turnAudio?.push(frame.userId, frame.pcm);
    },
    onJoined: (session) => {
      if (options.key === null) return;
      try {
        transcriber = options.create(options.key);
      } catch {
        // The error is not logged: it can carry what the factory was handed, the key among it.
        transcriber = null;
        options.log("voice: transcription could not start, so the voice channel is deaf");
        return;
      }
      // Subscribed before the bridge attaches, for the reason the barge-in rule is: the turn's audio
      // is cut on its end before the bridge hands that end to the fast tier, which reads the cut.
      const keeper = createTurnAudio({ seconds: options.turnAudioSeconds, speakerId: session.senderId });
      turnAudio = keeper;
      unbindAudio = transcriber.onTurn((event) => keeper.take(event));
      // Bound before the bridge attaches, because the transcriber calls its listeners in the order
      // they subscribed: on a long cut-in the barge-in rule's discard must reach the bridge before
      // the bridge acts on that same end, or it would queue the replies it held through the
      // operator's turn and have the discard cancel them in the next breath.
      unbind = bindBargeIn(
        transcriber,
        session.player,
        options.shortTurnWords,
        (turn, cut) => attached?.onDiscard(turn, cut),
        {
          speaking: () => attached?.speaking?.() ?? false,
          onHeldShort: (turn) => attached?.onHeldShort?.(turn),
        },
      );
      try {
        attached = options.attach?.({ ...session, transcriber, turnAudio: (turn) => keeper.audioFor(turn) }) ?? null;
      } catch {
        // Not logged with the error, for the reason the factory's is not.
        attached = null;
        options.log("voice: the bridge could not start, so every turn is heard and none is answered");
      }
    },
    onLeft: () => {
      attached?.detach();
      attached = null;
      unbind?.();
      unbind = null;
      unbindAudio?.();
      unbindAudio = null;
      turnAudio?.clear();
      turnAudio = null;
      transcriber?.close();
      transcriber = null;
    },
  };
}
