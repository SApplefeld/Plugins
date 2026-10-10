// The voice channel connection: joins the channel an operator sits in on their `voice on`, hears
// each operator as 48 kHz mono PCM, plays PCM back through the player, and leaves on `voice off`,
// when the last operator leaves the channel, or after a stretch with no operator audio.
//
// The operator-only rule lives here and nowhere else: a speaker the sender gate does not class as
// operator is never subscribed to, so their audio is not decoded and reaches no consumer.
//
// Loaded only by a broker with `CHANNEL_VOICE` on, through a dynamic import, so the voice library
// and the Opus codec stay off the off path entirely.
import {
  EndBehaviorType,
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import type { DiscordGatewayAdapterCreator } from "@discordjs/voice";
import OpusScript from "opusscript";
import type { VoiceGateway } from "../routing/gateway.ts";
import type { VoiceCommand } from "../routing/inbound.ts";
import type { SenderGate } from "../security/senders.ts";
import { SAMPLE_RATE, createPlayer } from "./player.ts";
import type { OpusSink, Player } from "./player.ts";

/** How long a join may take to reach a ready connection before it is called failed. */
export const JOIN_TIMEOUT_MS = 15_000;
/** How far behind the operator the loopback plays their audio. */
export const LOOPBACK_DELAY_MS = 2_000;
/**
 * The silence after which a speaker's receive stream ends. The next speaking signal opens a new
 * one, so a pause costs no subscription held open.
 */
const RECEIVE_SILENCE_MS = 1_000;
/**
 * How long a disconnected connection is given to start reconnecting on its own, as the library does
 * after a voice server move, before it is called gone.
 */
export const RECONNECT_GRACE_MS = 5_000;

export const NO_CHANNEL_NOTICE =
  "You are not in a voice channel the bot can join, so it did not join. A stage channel is not " +
  "supported. Join an ordinary voice channel and type voice on again.";
export const IN_USE_NOTICE =
  "The voice is in use in another session's thread. Type voice off there, or leave that voice " +
  "channel, first.";
export const JOIN_FAILED_NOTICE =
  "The bot could not join your voice channel. Check that it has the Connect permission there; " +
  "the broker log has the cause.";

/** One frame of an operator's audio: 20 ms of 48 kHz 16-bit mono PCM, tagged with its account. */
export type VoiceFrame = { userId: string; pcm: Buffer };

/** The receive side of a joined connection, reduced to the two calls this module makes. */
export type VoiceReceiverPort = {
  /** Calls `listener` with the account id each time someone starts speaking. */
  onSpeakingStart: (listener: (userId: string) => void) => void;
  /**
   * Opens the account's stream of Opus packets, ending after a short silence. Returns the call
   * that closes it early.
   */
  subscribe: (userId: string, onPacket: (packet: Buffer) => void, onEnd: () => void) => () => void;
};

/** A joined voice connection, as this module drives it. */
export type VoiceLink = {
  /** Settles once the connection is ready, and rejects when `signal` aborts first. */
  ready: (signal: AbortSignal) => Promise<void>;
  receiver: VoiceReceiverPort;
  sink: OpusSink;
  /** Leaves the channel. Safe to call on a link already gone. */
  destroy: () => void;
  /**
   * Calls `listener` once the connection is gone without this module leaving: disconnected with
   * no reconnect under way, which an admin disconnect or a kick from the channel is.
   */
  onGone: (listener: () => void) => void;
};

export type JoinVoice = (input: {
  guildId: string;
  channelId: string;
  adapterCreator: NonNullable<ReturnType<VoiceGateway["adapterCreator"]>>;
  log: (message: string) => void;
}) => VoiceLink;

/** Decodes one Opus packet to 16-bit mono PCM at 48 kHz. */
export type OpusDecoder = { decode: (packet: Buffer) => Buffer; delete: () => void };

/**
 * Joins through `@discordjs/voice`, undeafened so the receiver hears, unmuted so the player speaks.
 * The connection's own error events are logged here, since an unheard `error` on an emitter ends
 * the process.
 */
export const joinWithLibrary: JoinVoice = ({ guildId, channelId, adapterCreator, log }) => {
  const connection = joinVoiceChannel({
    guildId,
    channelId,
    adapterCreator: adapterCreator as unknown as DiscordGatewayAdapterCreator,
    selfDeaf: false,
    selfMute: false,
  });
  connection.on("error", (error) => {
    log(`voice: the voice connection reported: ${String(error)}`);
  });
  let gone: (() => void) | null = null;
  // The library's own pattern: a disconnect that moves to signalling or connecting within the grace
  // is a reconnect under way, and one that does not is the connection gone for good.
  connection.on(VoiceConnectionStatus.Disconnected, () => {
    void Promise.race([
      entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_GRACE_MS),
      entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_GRACE_MS),
    ]).catch(() => {
      gone?.();
    });
  });
  return {
    onGone: (listener) => {
      gone = listener;
    },
    ready: async (signal) => {
      await entersState(connection, VoiceConnectionStatus.Ready, signal);
    },
    receiver: {
      onSpeakingStart: (listener) => {
        connection.receiver.speaking.on("start", listener);
      },
      subscribe: (userId, onPacket, onEnd) => {
        const stream = connection.receiver.subscribe(userId, {
          end: { behavior: EndBehaviorType.AfterSilence, duration: RECEIVE_SILENCE_MS },
        });
        stream.on("data", onPacket);
        stream.once("close", onEnd);
        stream.on("error", (error) => {
          log(`voice: a receive stream reported: ${String(error)}`);
        });
        return () => {
          stream.destroy();
        };
      },
    },
    sink: {
      playOpusPacket: (packet) => connection.playOpusPacket(packet),
      setSpeaking: (speaking) => connection.setSpeaking(speaking),
    },
    destroy: () => {
      if (connection.state.status !== VoiceConnectionStatus.Destroyed) connection.destroy();
    },
  };
};

export type VoiceOptions = {
  gateway: VoiceGateway;
  /** The sender gate. Only an account it classes as operator is heard. */
  gate: Pick<SenderGate, "classOf">;
  /** No operator audio for this long ends the session. */
  idleMs: number;
  /** Plays each operator's audio back after `LOOPBACK_DELAY_MS`, the development check. */
  loopback: boolean;
  /** Takes every operator frame, after the operator-only drop. */
  onFrame?: (frame: VoiceFrame) => void;
  /**
   * Called once a join is complete, with the joined channel's player, the thread and session
   * `voice on` was typed in, and the operator who typed it.
   */
  onJoined?: (session: { player: Player; threadId: string; sessionId: string; senderId: string }) => void;
  /** Called once when a channel `onJoined` was called for is left, before the next join. */
  onLeft?: () => void;
  join?: JoinVoice;
  decoder?: () => OpusDecoder;
  player?: (sink: OpusSink) => Player;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  now?: () => number;
  log?: (message: string) => void;
};

export type Voice = {
  /** Runs one operator command from a session's thread, answering the notice to post, or null. */
  command: (input: {
    threadId: string;
    sessionId: string;
    senderId: string;
    command: VoiceCommand;
  }) => Promise<string | null>;
  /** Where the bot sits now, or null when it is in no channel. */
  joined: () => { threadId: string; channelId: string } | null;
  /** Leaves any channel, clears every timer and stops listening, and settles once a join in flight has. */
  stop: () => Promise<void>;
};

/** One joined channel and everything that lives only as long as it does. */
type Session = {
  threadId: string;
  sessionId: string;
  senderId: string;
  channelId: string;
  link: VoiceLink | null;
  abort: AbortController;
  ready: boolean;
  player: Player | null;
  subscriptions: Map<string, { close: () => void; decoder: OpusDecoder }>;
  loopbackTimers: Set<NodeJS.Timeout>;
  idleTimer: NodeJS.Timeout | null;
  lastHeard: number;
  subscribeFailed: boolean;
  /** Whether `onJoined` was called for this session, so `onLeft` answers exactly those. */
  announced: boolean;
};

export function createVoice(options: VoiceOptions): Voice {
  const log = options.log ?? ((): void => {});
  const join = options.join ?? joinWithLibrary;
  const decoder =
    options.decoder ?? ((): OpusDecoder => new OpusScript(SAMPLE_RATE, 1, OpusScript.Application.AUDIO));
  const makePlayer = options.player ?? ((sink: OpusSink) => createPlayer({ sink, log }));
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const now = options.now ?? Date.now;

  let session: Session | null = null;
  let joining: Promise<string | null> | null = null;
  let stopped = false;

  const isOperator = (userId: string): boolean => options.gate.classOf(userId) === "operator";

  function leave(reason: string): void {
    const held = session;
    if (held === null) return;
    session = null;
    held.abort.abort();
    if (held.idleTimer !== null) clearTimer(held.idleTimer);
    for (const timer of held.loopbackTimers) clearTimer(timer);
    held.loopbackTimers.clear();
    for (const { close, decoder: open } of held.subscriptions.values()) {
      try {
        close();
      } catch {
        // A stream already closed has nothing left to close.
      }
      open.delete();
    }
    held.subscriptions.clear();
    held.player?.close();
    if (held.announced) hook("onLeft", () => options.onLeft?.());
    try {
      held.link?.destroy();
    } catch (error) {
      log(`voice: leaving the voice channel failed: ${String(error)}`);
    }
    log(`voice: left voice channel ${held.channelId}, ${reason}`);
  }

  /** Runs a consumer's hook, so a failing consumer cannot break a join or a leave. */
  function hook(name: string, call: () => void): void {
    try {
      call();
    } catch (error) {
      log(`voice: the ${name} consumer failed: ${String(error)}`);
    }
  }

  function armIdle(held: Session, ms: number): void {
    held.idleTimer = setTimer(() => {
      held.idleTimer = null;
      if (session !== held) return;
      const quiet = now() - held.lastHeard;
      if (quiet >= options.idleMs) {
        leave(`no operator audio for ${String(options.idleMs)}ms`);
        return;
      }
      armIdle(held, options.idleMs - quiet);
    }, ms);
  }

  function frame(held: Session, userId: string, pcm: Buffer): void {
    held.lastHeard = now();
    if (options.loopback && held.player !== null) {
      const player = held.player;
      const timer = setTimer(() => {
        held.loopbackTimers.delete(timer);
        if (session === held) player.play(pcm);
      }, LOOPBACK_DELAY_MS);
      held.loopbackTimers.add(timer);
    }
    if (options.onFrame !== undefined) {
      try {
        options.onFrame({ userId, pcm });
      } catch (error) {
        log(`voice: an audio consumer failed: ${String(error)}`);
      }
    }
  }

  function hear(held: Session, link: VoiceLink, userId: string): void {
    if (session !== held || held.subscriptions.has(userId)) return;
    // The operator-only rule: a speaker the gate does not class as operator is never subscribed,
    // so nothing of theirs is decoded or handed on.
    if (!isOperator(userId)) return;
    const open = decoder();
    const entry = { close: () => {}, decoder: open };
    const onPacket = (packet: Buffer): void => {
      if (session !== held) return;
      let pcm: Buffer;
      try {
        pcm = open.decode(packet);
      } catch {
        // A packet the decoder cannot read is dropped alone; the stream goes on.
        return;
      }
      frame(held, userId, pcm);
    };
    const onEnd = (): void => {
      if (held.subscriptions.get(userId) !== entry) return;
      held.subscriptions.delete(userId);
      open.delete();
    };
    try {
      entry.close = link.receiver.subscribe(userId, onPacket, onEnd);
    } catch (error) {
      // No entry is kept, so the account's next speaking signal tries again. Logged once a session,
      // since a receiver that refuses one subscription tends to refuse every one after it.
      open.delete();
      if (!held.subscribeFailed) {
        held.subscribeFailed = true;
        log(`voice: opening a receive stream failed: ${String(error)}`);
      }
      return;
    }
    held.subscriptions.set(userId, entry);
  }

  async function on(threadId: string, sessionId: string, senderId: string): Promise<string | null> {
    if (session !== null) return session.threadId === threadId ? null : IN_USE_NOTICE;
    const channelId = options.gateway.channelOf(senderId);
    if (channelId === null) return NO_CHANNEL_NOTICE;
    const guildId = options.gateway.guildId();
    const adapterCreator = options.gateway.adapterCreator();
    if (guildId === null || adapterCreator === null) {
      log("voice: the voice cannot join yet, the configured channel's guild is not cached");
      return JOIN_FAILED_NOTICE;
    }
    const held: Session = {
      threadId,
      sessionId,
      senderId,
      channelId,
      link: null,
      abort: new AbortController(),
      ready: false,
      player: null,
      subscriptions: new Map(),
      loopbackTimers: new Set(),
      idleTimer: null,
      lastHeard: now(),
      subscribeFailed: false,
      announced: false,
    };
    session = held;
    try {
      held.link = join({ guildId, channelId, adapterCreator, log });
      await held.link.ready(AbortSignal.any([held.abort.signal, AbortSignal.timeout(JOIN_TIMEOUT_MS)]));
    } catch (error) {
      // Left while joining, by `voice off` or the broker stopping: nothing to report.
      if (session !== held) return null;
      log(`voice: joining voice channel ${channelId} failed: ${String(error)}`);
      leave("the join failed");
      return JOIN_FAILED_NOTICE;
    }
    if (session !== held) return null;
    const link = held.link;
    held.ready = true;
    // The operator may have left while the join was under way, when the voice-state event that
    // would have ended the session was ignored for a session not yet ready.
    if (!options.gateway.membersOf(channelId).some(isOperator)) {
      leave("the last operator left the channel");
      return null;
    }
    link.onGone(() => {
      if (session === held) leave("the voice connection dropped");
    });
    held.player = makePlayer(link.sink);
    const player = held.player;
    held.announced = true;
    hook("onJoined", () => options.onJoined?.({ player, threadId, sessionId, senderId }));
    held.lastHeard = now();
    armIdle(held, options.idleMs);
    link.receiver.onSpeakingStart((userId) => hear(held, link, userId));
    log(
      `voice: joined voice channel ${channelId} for thread ${threadId}` +
        (options.loopback ? ", with the loopback on" : ""),
    );
    return null;
  }

  // The last operator leaving the channel ends the session, whoever else stays in it, and so does
  // the bot itself being moved or disconnected out of it.
  const unlisten = options.gateway.onVoiceState((change) => {
    const held = session;
    if (held === null || !held.ready) return;
    if (change.userId === options.gateway.selfId() && change.after !== held.channelId) {
      leave("the bot was moved or disconnected from the channel");
      return;
    }
    if (change.before !== held.channelId || change.after === held.channelId) return;
    if (options.gateway.membersOf(held.channelId).some(isOperator)) return;
    leave("the last operator left the channel");
  });

  return {
    async command({ threadId, sessionId, senderId, command }) {
      if (stopped) return null;
      if (command === "off") {
        // Mirrors `voice on`: only the thread that holds the voice can end it.
        if (session === null) return null;
        if (session.threadId !== threadId) return IN_USE_NOTICE;
        leave("on an operator's voice off");
        return null;
      }
      const attempt = on(threadId, sessionId, senderId);
      joining = attempt;
      try {
        return await attempt;
      } finally {
        if (joining === attempt) joining = null;
      }
    },
    joined: () => (session === null ? null : { threadId: session.threadId, channelId: session.channelId }),
    async stop() {
      stopped = true;
      unlisten();
      leave("the broker is stopping");
      const inFlight = joining;
      if (inFlight !== null) await inFlight.catch(() => null);
    },
  };
}
