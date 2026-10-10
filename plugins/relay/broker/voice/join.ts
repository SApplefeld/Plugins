// The voice's join-time wiring: what one joined channel gets built around it and released with it.
// `voiceJoin` answers the transcription hooks' `attach` for each join with the bridge, the fast
// tier and the speaker for that channel, built from the collaborators the broker holds for the life
// of the process, and hands back the barge-in rule's discard and the detach the leave runs. Lifted
// out of the broker's start so the wiring is tested with fakes rather than pinned from source.
import { renderAnswer } from "../discord/render.ts";
import type { CallOutcome } from "../discord/transport.ts";
import { postThroughRateLimits } from "../routing/outbound.ts";
import type { PostClock } from "../routing/outbound.ts";
import type { RelayEvent } from "../routing/relays.ts";
import type { SenderGate } from "../security/senders.ts";
import { createVoiceBridge } from "./bridge.ts";
import type { BridgeSession, TierBinding, VoiceBridge } from "./bridge.ts";
import type { FastTier } from "./fast.ts";
import type { Player } from "./player.ts";
import type { LineNames } from "./rank.ts";
import type { Speaker } from "./speaker.ts";
import type { Transcriber } from "./transcriber.ts";
import type { Attached, JoinedSession } from "./transcription.ts";

export type { TierBinding };

/** What the speaker's factory is handed: the timed player and where unspoken words go. */
export type SpeakerBinding = {
  player: Pick<Player, "play" | "stop">;
  fallback: (text: string) => Promise<void>;
};

export type VoiceJoinOptions = {
  /** The sender gate: only an operator-class account leaves a line or is handed off. */
  gate: Pick<SenderGate, "classOf">;
  /**
   * The session bound to a thread, the live one over an ended one, as the inbound router resolves
   * a thread's message. Read at each use, never held.
   */
  sessionBoundTo: (threadId: string) => BridgeSession | null;
  /**
   * The name the thread's bound session shows in its thread title, or null where none is bound.
   * Read at each line, so a rename shows from the next line on.
   */
  sessionName: (threadId: string) => string | null;
  /**
   * The name the gateway attributes an account's messages to, from its voice-state cache, or null
   * for one it does not hold. Read at each line, for the account that spoke it.
   */
  nameOf: (senderId: string) => string | null;
  /** The registry's reading of whether a session's open turn has gone quiet, for the bridge. */
  quiet: (sessionId: string) => boolean;
  /** `relays.deliver`: hands the event to the session's pipe, or answers false with none attached. */
  deliver: (processToken: string, event: RelayEvent) => boolean;
  /** The mirror writer: the floored notice, and the paced reply post every voice line rides. */
  writer: {
    notice: (threadId: string, text: string) => Promise<boolean>;
    reply: (threadId: string, text: string) => Promise<CallOutcome<unknown>>;
  };
  /** `CHANNEL_MIRROR`. */
  mirror: boolean;
  /** `CHANNEL_VOICE_MAX_SPOKEN_WORDS`. */
  maxSpokenWords: number;
  /** `CHANNEL_VOICE_EAGER_SETTLE_MS`. */
  eagerSettleMs: number;
  /** The typing keeper's hold, or a no-op where no keeper is built. */
  hold: (threadId: string, until: number) => () => void;
  /** How long a held typing line stands with no frame to release it. */
  holdMs: number;
  /**
   * Builds the fast tier for one joined channel, with the bridge's binding and the reading of the
   * operator's audio cut at each turn's end.
   */
  tier: (binding: TierBinding & { turnAudio: (turn: number) => Buffer | null }) => FastTier;
  /** Builds the voice for one joined channel, or null where the voice is mute. */
  speaker: ((binding: SpeakerBinding) => Speaker) | null;
  /** Told the bridge each join builds, which is the one the outbound router's reply tap reaches. */
  attached: (bridge: VoiceBridge) => void;
  /** Told the bridge each leave releases, after it has left. */
  detached: (bridge: VoiceBridge) => void;
  log: (message: string) => void;
  /** The clock a rate-limited post waits on. Injected so a test reads the waits without sleeping. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * The `attach` the transcription hooks call on each join. The bridge, the fast tier and the speaker
 * live exactly as long as the joined channel: built here and released by the returned detach.
 */
export function voiceJoin(
  options: VoiceJoinOptions,
): (
  session: JoinedSession & {
    transcriber: Pick<Transcriber, "onTurn">;
    turnAudio: (turn: number) => Buffer | null;
  },
) => Attached {
  const clock: PostClock = {
    now: options.now ?? Date.now,
    sleep:
      options.sleep ??
      ((ms: number): Promise<void> =>
        new Promise((resolve) => {
          // Unreferenced, so a pending wait is not something the process waits out before it can
          // exit: a shutdown mid-wait drops the post rather than delaying the shutdown.
          setTimeout(resolve, ms).unref();
        })),
  };

  /**
   * One message to the thread through the writer's reply post, paced as a reply's run is: a
   * rate-limited refusal is waited out and the same message goes again, under the run cap, which
   * here bounds the waiting for this one message. Answers whether it landed. A refusal of any other
   * class, and a wait that would pass the cap, answer false, and the caller logs the one line.
   */
  function paced(threadId: string, message: string): Promise<boolean> {
    return postThroughRateLimits(() => options.writer.reply(threadId, message), 0, clock).then(
      ({ outcome }) => outcome !== null && outcome.status === "ok",
    );
  }

  /**
   * Where an answer the service could not speak goes. With the mirror on it goes nowhere: the
   * bridge posted the line to the thread before the speaker was asked for it, so posting the
   * unspoken words again would put the answer in the thread twice. With the mirror off this is the
   * only copy of those words the operator gets, so it is posted whatever else the mirror withholds,
   * rendered as a reply tool's answer is: it is the same class of text landing in the same thread,
   * and it is paced as that answer is, so a blocked bucket delays it rather than losing it.
   */
  function unspoken(threadId: string, text: string): Promise<void> {
    if (options.mirror) return Promise.resolve();
    let posts: Promise<void> = Promise.resolve();
    for (const message of renderAnswer(text)) {
      posts = posts
        .then(() => paced(threadId, message))
        .then((landed) => {
          if (!landed) {
            options.log(`voice: the thread refused an unspoken answer for thread ${threadId}`);
          }
        });
    }
    return posts;
  }

  return ({ transcriber, turnAudio, player, threadId, sessionId }) => {
    // The session's name is what its thread title shows, through the same bounding and the same
    // strip; the operator's is the name the gateway attributes their messages to. Both are
    // resolved at each use, never held: the session's name follows a rename, and an operator's line
    // is named for the account that spoke it, which the gateway's voice-state cache holds for every
    // account in the channel. One the cache does not hold is named by its id.
    const names = (speakerId: string): LineNames => ({
      speaker: options.nameOf(speakerId) ?? speakerId,
      session: options.sessionName(threadId) ?? sessionId,
    });
    const speaker = options.speaker;
    const bridge = createVoiceBridge({
      threadId,
      names,
      gate: options.gate,
      session: () => options.sessionBoundTo(threadId),
      deliver: options.deliver,
      quiet: options.quiet,
      notice: (id, text) => options.writer.notice(id, text),
      post: paced,
      mirror: options.mirror,
      maxSpokenWords: options.maxSpokenWords,
      eagerSettleMs: options.eagerSettleMs,
      player,
      hold: options.hold,
      holdMs: options.holdMs,
      tier: (binding) => options.tier({ ...binding, turnAudio }),
      speaker:
        speaker === null
          ? null
          : (timed) =>
              speaker({
                player: { play: (pcm) => timed.play(pcm), stop: () => player.stop() },
                fallback: (text) => unspoken(threadId, text),
              }),
      log: options.log,
    });
    const unsubscribe = transcriber.onTurn((event) => bridge.take(event));
    options.attached(bridge);
    return {
      onDiscard: (turn, cut) => bridge.cutIn(turn, cut),
      // Mid-reply is either half: a speech handed to the speaker and not settled, which covers the
      // gap before a segment's first frame, or frames the player still holds after the last settled.
      speaking: () => bridge.speaking() || player.queued() > 0,
      onHeldShort: (turn) => bridge.heldShort(turn),
      detach: () => {
        unsubscribe();
        bridge.leave();
        options.detached(bridge);
      },
    };
  };
}
