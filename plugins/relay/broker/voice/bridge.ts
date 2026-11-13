// The slow tier bridge: one per joined channel, standing between the transcriber, the fast tier
// and the session bound to the thread `voice on` was typed in, the main model's. It hands a turn
// the helper cannot answer to that session as a relay event carrying the ring's lines since the
// last hand-off, speaks the session's replies from the turn that takes a hand-off until that turn
// ends, routes the operator's answer to an ASK straight back to the session, and posts every
// operator turn to the thread as text, and every answer of the helper's, the stopped line and the
// cannot-reach line under the helper's form, so the transcript is readable afterwards. A stop
// phrase over a reading stops the reading and goes no further, and one said while the session is
// working with nothing being read goes to the session unranked. A session reply is in the thread
// already and a hand-off line only says where the turn went, so neither is posted. The typing line
// is held from a turn's end until the first frame of what answers it. The bridge keeps the wait,
// open from a hand-off delivered until the session's turn ends, and tells the tier how long it has
// been open. While the wait is open and no speech is in flight it sets the waiting pulse on the
// player, so the operator hears that the main model is working.
//
// Everything here is bounded so that nothing throws to the transcriber or to the outbound path:
// a failure is logged by session id, never with any text. A rate-limited thread post is waited out
// in join.ts before the bridge sees its outcome, and a post refused for any other reason is dropped.
import { renderVoiceLine } from "../discord/render.ts";
import type { VoiceLineRole } from "../discord/render.ts";
import { findAskLine } from "../decisions/ask.ts";
import { ENDED_NOTICE, unreachableNotice } from "../routing/inbound.ts";
import type { RelayEvent } from "../routing/relays.ts";
import { bufferedEvent } from "../routing/response-gate.ts";
import type { SessionState } from "../registry.ts";
import type { SenderGate } from "../security/senders.ts";
import { withTone } from "./fast.ts";
import type { FastTier, Remember, TierSpeaker } from "./fast.ts";
import { STOPPED_LINE, isStopPhrase } from "./interrupt.ts";
import type { FillSource, Player } from "./player.ts";
import { conversationLine } from "./rank.ts";
import type { LineNames } from "./rank.ts";
import type { Speaker } from "./speaker.ts";
import type { TurnEvent } from "./transcriber.ts";
import { wordCount } from "./transcriber.ts";

/** Spoken in place of an answer when the turn had no session to go to. */
export const CANNOT_REACH_LINE =
  "I cannot reach the main model right now, so that question is not answered here. The thread says why.";

/** How many words of a session's reply the ring keeps, counted on whitespace over the reply as written. */
const REMEMBERED_REPLY_WORDS = 120;
/** Closes a session's reply the ring keeps cut, so its readers know the operator heard the rest. */
const REST_READ_ALOUD_NOTE = " (The rest of this reply was read aloud.)";

/** How often the wait is checked while it is open: the binding each time, the quiet window past the grace. */
const WAIT_CHECK_MS = 5_000;
/**
 * How long after each delivered hand-off the quiet window goes unread: the session has not yet
 * opened the turn that takes the hand-off, and its typing line reads quiet until it does.
 */
const QUIET_GRACE_MS = 10_000;

/** The session bound to the thread, as far as the bridge needs it. */
export type BridgeSession = { sessionId: string; processToken: string; state: SessionState };

/** What the fast tier's factory is handed: the names for its lines and the bridge's binding. */
export type TierBinding = {
  /** The two names as they read now, for the operator whose turn the tier is weighing. */
  names: () => LineNames;
  speaker: TierSpeaker | null;
  player: Pick<Player, "play">;
  /**
   * The turn's text as the ring holds it and its tone, where the transcriber heard one. The event
   * the session is handed carries the turn with `withTone`'s note, ` (sounded <label>)`, after it
   * where the label fits that note's shape. Returns whether the session was handed the turn; where
   * it was not, the cannot-reach line has been spoken before this returns.
   */
  handOff: (turn: string, tone?: string) => boolean;
  /** How long the wait has been open, in milliseconds, or null while it is closed. */
  waitMs: () => number | null;
  /**
   * An answer whose turn was withdrawn while its speech was in flight: the bridge forgets it, so a
   * half-turn's answer is never remembered without its question.
   */
  forget: (text: string) => void;
};

export type VoiceBridgeOptions = {
  /** The thread `voice on` was typed in: where the lines are posted and the hand-offs are bound. */
  threadId: string;
  /**
   * The two names the line forms carry, read at each use and never held: the display name of the
   * account `speakerId` names, and the session's name as its thread title shows it now.
   */
  names: (speakerId: string) => LineNames;
  /** Only a speaker the gate classes as operator leaves a line or is handed off. */
  gate: Pick<SenderGate, "classOf">;
  /** The session bound to the thread now, or null where none is. Read at each use, never held. */
  session: () => BridgeSession | null;
  /** `relays.deliver`: hands the event to the session's pipe, or answers false with none attached. */
  deliver: (processToken: string, event: RelayEvent) => boolean;
  /**
   * The registry's reading of whether the session's open turn has gone quiet: no turn open, or one
   * past the activity window the typing line stops at. Read at a prompt signal that takes no
   * hand-off while a hand-off turn is open, which is how a turn that ended without a Stop closes.
   */
  quiet: (sessionId: string) => boolean;
  /** The floored thread notice, for a hand-off that had nowhere to go. */
  notice: (threadId: string, text: string) => Promise<boolean>;
  /** The mirror writer's paced reply post of one rendered message, answering whether it landed. */
  post: (threadId: string, message: string) => Promise<boolean>;
  /** `CHANNEL_MIRROR`: off keeps the voice lines off the thread as it keeps replies off. */
  mirror: boolean;
  /**
   * The joined channel's player. Its `play` is wrapped so the first frame of an answer releases the
   * typing line; `fill` sets the waiting pulse and is not wrapped, so a pulse frame releases nothing.
   */
  player: Pick<Player, "play" | "fill">;
  /** The waiting pulse, or null where its volume is 0. A mute voice has no pulse whatever this holds. */
  pulse: FillSource | null;
  /** The wait's check timer. Injected so a test fires it by hand; the default is unref'd. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  /** Holds the thread's typing line until `until` or until the returned release runs. */
  hold: (threadId: string, until: number) => () => void;
  /** How long a held typing line stands with no frame to release it. */
  holdMs: number;
  /**
   * Builds the fast tier for this channel, around the speaker and player the bridge hands it and
   * with the bridge's own hand-off. A factory, because the speaker is built from the tier's timed
   * player and the tier from the speaker: the bridge closes that loop.
   */
  tier: (binding: TierBinding) => FastTier;
  /** Builds the voice around the tier's timed player, or null where the voice is mute. */
  speaker: ((player: Pick<Player, "play">) => Speaker) | null;
  log: (message: string) => void;
  now?: () => number;
};

export type VoiceBridge = {
  /** Takes every turn event, ahead of the fast tier. */
  take: (event: TurnEvent) => void;
  /**
   * A reply from `sessionId` reached its thread: spoken where that session's running turn took a
   * hand-off, else ignored.
   */
  reply: (sessionId: string, text: string) => void;
  /**
   * Session `sessionId` opened a turn, the prompt signal, fired for a prompt that starts a turn and
   * for a queued event injected into a running one alike. The signal takes every hand-off
   * delivered to the session before it and opens the hand-off turn, or keeps it open, until the
   * turn's Stop. A signal that takes nothing while a hand-off turn is open is typed text injected
   * into that turn, and leaves it open, unless the registry reads the turn quiet, in which case the
   * turn ended without a Stop and the signal closes it.
   */
  turnOpened: (sessionId: string) => void;
  /** Session `sessionId` closed a turn, its Stop. A hand-off turn it closes is no longer open. */
  turnClosed: (sessionId: string) => void;
  /**
   * A long turn `turn` ended: the speaker is cancelled and the tier told, so work for the other
   * turns is dropped. `cut` is the barge-in rule's reading of whether the persona was still
   * speaking: then the lines not yet remembered were cut short and are dropped; otherwise they were
   * heard through and are remembered first.
   */
  cutIn: (turn: number, cut: boolean) => void;
  /**
   * The barge-in rule's reading that `turn` was a passing remark: a short turn that ended while the
   * persona was mid-reply, or a turn of any length the judging stage read as stray over a paused
   * reading. Its end, which follows this call, is posted and neither ranked nor handed off.
   */
  heldShort: (turn: number) => void;
  /**
   * The barge-in rule's reading that `turn` is a stop phrase spoken over a reading: the speaker is
   * cancelled, the replies held behind the operator's turn are dropped, and the tier is told, as
   * for a cut-in. The turn's end, which follows this call, is posted and remembered, answered with
   * the stopped line, and neither ranked nor handed off. The session's turn stays open, so a reply
   * it sends later is spoken.
   */
  stopped: (turn: number) => void;
  /**
   * Whether a speech handed to the speaker has not settled and no cut-in or stop has cancelled the
   * speech since the last one started: the persona is mid-reply.
   */
  speaking: () => boolean;
  /** The channel is left: the speaker is cancelled, the tier cleared, and nothing stays pending. */
  leave: () => void;
};

export function createVoiceBridge(options: VoiceBridgeOptions): VoiceBridge {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref());
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const { threadId } = options;
  // Hand-offs delivered and not yet taken by a prompt signal, oldest first, each the session it
  // went to.
  const queue: string[] = [];
  // The session whose turn took a hand-off, or null while no hand-off turn is open. Every reply
  // that turn sends is spoken, and its close leaves nothing open until the next signal that takes.
  let openTurn: string | null = null;
  // When the wait opened: the delivery of the hand-off that found it closed. Read only while the
  // wait is open.
  let waitOpenedAt = 0;
  // When the latest hand-off was delivered: the quiet window is read only once the grace has run
  // from here. Read only while the wait is open.
  let graceFrom = 0;
  // Whether the operator holds the floor: a turn started and not yet ended.
  let floor = false;
  // Replies that arrived while the operator held the floor, spoken in order at the turn's end.
  const held: string[] = [];
  // A spoken reply that asked: the operator's next spoken turn answers it directly.
  let askOpen = false;
  // The turn the barge-in rule read as a backchannel over held speech, or null. Set just ahead of
  // that turn's end and cleared by it.
  let backchannel: number | null = null;
  // The turn the barge-in rule read as a stop phrase over a reading, or null. Set just ahead of
  // that turn's end and cleared by it.
  let stop: number | null = null;
  let releaseTyping: (() => void) | null = null;
  // The account whose turn the tier is weighing, for the hand-off event's sender.
  let speakerId = "";
  // The thread posts in flight, chained so a line's messages land in order behind the line before.
  let posting: Promise<void> = Promise.resolve();
  // The waiting pulse: none with a mute voice, since there is no voice to wait for.
  const pulse = options.speaker === null ? null : options.pulse;
  // Whether the pulse is set on the player now.
  let pulseOn = false;
  // The quiet window's last reading past the grace, true where the session's turn has gone quiet.
  let quietNow = false;
  // The wait's check, armed while the wait is open and a pulse can sound.
  let waitCheck: NodeJS.Timeout | null = null;

  function session(): BridgeSession | null {
    try {
      return options.session();
    } catch {
      return null;
    }
  }

  /**
   * The bound session the queue answers to now, or null with the queue cleared where the thread's
   * session is gone or ended, and the pulse brought in line at once where that dropped a hand-off
   * or the open turn, so a wait its session's end or change closed is silent from the first read.
   */
  function bound(): BridgeSession | null {
    const before = queue.length + (openTurn === null ? 0 : 1);
    const current = prune();
    if (queue.length + (openTurn === null ? 0 : 1) < before) syncPulse();
    return current;
  }

  /**
   * `bound` without the pulse, for the pulse's own reading of the wait. A hand-off delivered to a
   * session no longer bound leaves with it, so a session that ends with a hand-off open never has
   * that hand-off taken by its successor's turn.
   */
  function prune(): BridgeSession | null {
    const current = session();
    if (current === null || current.state === "ended") {
      queue.length = 0;
      openTurn = null;
      return null;
    }
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (queue[index] !== current.sessionId) queue.splice(index, 1);
    }
    if (openTurn !== null && openTurn !== current.sessionId) openTurn = null;
    return current;
  }

  /** The line's attribution as it reads now: the account that spoke, or the session's name. */
  function post(role: VoiceLineRole, name: string, text: string): void {
    if (!options.mirror) return;
    const sessionId = session()?.sessionId ?? "none";
    // Rendered by the machinery a mirrored reply is rendered by, which is what keeps a spoken line
    // from drawing the operator's quoted block or a chip in the thread the voice posts into.
    for (const message of renderVoiceLine(role, name, text)) {
      posting = posting
        .then(() => options.post(threadId, message))
        .then(
          (landed) => {
            if (!landed) options.log(`voice: the thread refused a voice line for session ${sessionId}`);
          },
          () => options.log(`voice: posting a voice line for session ${sessionId} failed`),
        );
    }
  }

  function releaseHold(): void {
    releaseTyping?.();
    releaseTyping = null;
  }

  const player: Pick<Player, "play"> = {
    play: (pcm) => {
      releaseHold();
      options.player.play(pcm);
    },
  };

  // The speaker the tier is handed: a line it posts goes to the thread before it is spoken, so the
  // post never depends on the speaker answering.
  let voice: Speaker | null = null;
  // Speeches handed to the speaker and not yet settled, the persona being mid-reply. The barge-in
  // rule reads it to tell a backchannel over the persona from a turn of the operator's own.
  let inFlight = 0;
  // Whether a cut-in or a stop has cancelled the speech since the last speak started. A cancelled
  // speak counts in `inFlight` until its promise settles, which can come after the judging stage
  // reads the next queued end, so the persona reads as silent from the cancel to the next speak.
  let cancelled = false;
  // The voice's lines spoken and not yet remembered, in speech order, each under the kind it is
  // remembered as: the helper's answer or the session's reply. A speak settles when its last frame
  // reaches the player, not when the operator has heard it, so a line is appended to the ring at
  // the next operator turn's end, once its speech has settled, and before anything reads the ring
  // for that turn. A cancel before then drops every pending line: a long turn that cut the persona
  // short, whose stop discarded whatever of them was still unheard, or a leave. A long turn after
  // the persona finished remembers them first, in `cutIn`. A line that names no kind, a hand-off
  // line or the cannot-reach line, is never pending.
  const pending: Array<{ text: string; writer: Remember; settled: boolean }> = [];
  const speaker: TierSpeaker | null =
    options.speaker === null
      ? null
      : {
          speak: async (text, remember) => {
            // A helper's answer has no other copy, the stopped line is spoken as one, and the
            // cannot-reach line is the thread's one record of a hand-off that failed: each is the
            // helper's and is posted under its form. A session reply is in the thread as written
            // already, and a hand-off line only says where the turn went, so neither is posted.
            if (remember === "answer" || text === CANNOT_REACH_LINE) {
              post("helper", options.names(speakerId).session, text);
            }
            // Pending from the moment it is handed to the speaker, so a cancel while it speaks
            // drops it; settled once the speaker is done with it, which is what lets the next
            // turn's end remember it. An entry a cancel already dropped is flagged to no effect.
            const entry = remember === undefined ? null : { text, writer: remember, settled: false };
            if (entry !== null) pending.push(entry);
            inFlight += 1;
            cancelled = false;
            syncPulse();
            // The voice's own contract is to settle without rejecting; this is the guard behind it,
            // so a tier waiting on the line is never left hanging by a broken speaker.
            try {
              // A session reply is in the thread from the outbound router already, so the speaker's
              // fallback must not post it a second time; a helper's answer has no other copy.
              await voice?.speak(text, { inThread: remember === "session reply" });
            } catch {
              options.log(`voice: the speaker failed on a line for thread ${threadId}`);
            } finally {
              inFlight -= 1;
              if (entry !== null) entry.settled = true;
              syncPulse();
            }
          },
          cancel: () => {
            pending.length = 0;
            voice?.cancel();
          },
        };

  /**
   * Drops the newest pending answer reading `text`: the tier withdrew its turn while the speech was
   * in flight, so the question is gone from the ring and the answer must not be remembered alone.
   */
  function forget(text: string): void {
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const entry = pending[index];
      if (entry.writer === "answer" && entry.text === text) {
        pending.splice(index, 1);
        return;
      }
    }
  }

  /** Remembers every pending line whose speech has settled, in order, and keeps the rest pending. */
  function commitSaid(): void {
    for (let index = 0; index < pending.length; ) {
      const entry = pending[index];
      if (!entry.settled) {
        index += 1;
        continue;
      }
      pending.splice(index, 1);
      tier.said(entry.writer === "session reply" ? remembered(entry.text) : entry.text, entry.writer);
    }
  }
  // The tier's names are the current speaker's, set at each operator end before the tier takes it.
  const tier = options.tier({
    names: () => options.names(speakerId),
    speaker,
    player,
    handOff,
    waitMs: () => (waiting() ? now() - waitOpenedAt : null),
    forget,
  });
  voice = options.speaker === null ? null : options.speaker(tier.player);

  function speakLine(text: string): void {
    tier.speak(text).catch(() => {});
  }

  /** The ring's lines since the last hand-off, in the line form, without the turn's own line. */
  function linesBefore(turn: string): string[] {
    const since = [...tier.ring.sinceMark()];
    const last = since[since.length - 1];
    if (last !== undefined && last.role === "user" && last.text === turn) since.pop();
    // One speaker name per hand-off, the operator whose turn this is: the ring holds no account
    // per line.
    const names = options.names(speakerId);
    return since.map((line) => conversationLine(line, names));
  }

  /**
   * Delivers the turn to the session: the ring's lines past the mark, found by the turn's text as
   * the ring holds it, then the turn with `withTone`'s note where it carries a tone that note takes.
   * Returns whether the session was handed it. Where it was not, the cannot-reach line is spoken
   * before this returns, so the tier speaks no hand-off line ahead of it.
   */
  function handOff(turn: string, tone?: string): boolean {
    const bound = session();
    try {
      if (bound === null || bound.state === "ended") {
        if (bound !== null) void options.notice(threadId, ENDED_NOTICE).catch(() => {});
        options.log(`voice: a hand-off had no live session for thread ${threadId}`);
        speakLine(CANNOT_REACH_LINE);
        return false;
      }
      const text = [...linesBefore(turn), withTone(turn, tone)].join("\n");
      const event = bufferedEvent(threadId, [
        {
          id: `voice-${String(now())}`,
          senderId: speakerId,
          author: options.names(speakerId).speaker,
          senderClass: "operator",
          text,
          truncated: false,
        },
      ]);
      if (!options.deliver(bound.processToken, event)) {
        void options.notice(threadId, unreachableNotice(1)).catch(() => {});
        options.log(`voice: session ${bound.sessionId} has no channel to hand a turn to`);
        speakLine(CANNOT_REACH_LINE);
        return false;
      }
      if (!waiting()) waitOpenedAt = now();
      graceFrom = now();
      queue.push(bound.sessionId);
      tier.ring.markNewest();
      // A hand-off is new work for the session, so a quiet reading taken before it no longer holds,
      // and none is taken until the session has had the grace to open the turn that takes it.
      quietNow = false;
      syncPulse();
      armWaitCheck();
      return true;
    } catch {
      options.log(`voice: handing a turn to session ${bound?.sessionId ?? "none"} failed`);
      speakLine(CANNOT_REACH_LINE);
      return false;
    }
  }

  /**
   * A session's reply as the ring keeps it: whole up to the word bound, else its first words and
   * the note. The ring rides every later call to the fast model and to Jev and every hand-off, so
   * one long reply is kept short there while the speaker is handed all of it.
   */
  function remembered(text: string): string {
    if (wordCount(text) <= REMEMBERED_REPLY_WORDS) return text;
    const words = text.split(/\s+/).filter((word) => word !== "");
    return `${words.slice(0, REMEMBERED_REPLY_WORDS).join(" ")}${REST_READ_ALOUD_NOTE}`;
  }

  function speakReply(text: string): void {
    // Open from the moment the question is handed to the speaker, never from when the reply was
    // queued behind the operator's turn: the words that ended that turn were not an answer to a
    // question not yet asked. A later reply with no ask of its own leaves an open ask standing,
    // since the operator still owes the answer: only the answering turn or a leave clears it.
    if (findAskLine(text) !== null) askOpen = true;
    // With no voice there is nothing to hear and nothing a cut-in could stop, so the reply is the
    // persona's words at once. With one, the speaker's wrapper holds it until it has been heard.
    // The speaker is handed the reply whole, and the ring keeps it by its first words.
    if (speaker === null) {
      tier.said(remembered(text));
      return;
    }
    tier.speak(text, "session reply").catch(() => {});
  }

  /**
   * Hands the answer to an ASK off, once: into the ring as the answer, then to the session, then
   * the outcome to the tier, which reads a delivered answer as a turn handed off and an undelivered
   * one, answered by the cannot-reach line, as a helper's line.
   */
  function deliverAnswer(turn: number, text: string, tone: string | undefined): void {
    // The answer reaches the session even where the tier fails to take its line. The ring takes the
    // text alone, and the hand-off takes it with the tone's note.
    try {
      tier.answeredAsk(turn, text);
    } finally {
      tier.askHandedOff(turn, handOff(text, tone));
    }
  }

  /**
   * Whether the wait is open: a hand-off is delivered to the bound session and not yet taken, or
   * that session's hand-off turn is open.
   */
  function waiting(): boolean {
    return bound() !== null && (queue.length > 0 || openTurn !== null);
  }

  /** `waiting` read through `prune`, so it never tells the player: the pulse's and the check's own reading. */
  function waitOpen(): boolean {
    return prune() !== null && (queue.length > 0 || openTurn !== null);
  }

  /**
   * Sets or clears the pulse to match the wait: set while the wait is open, no speech is in flight
   * and the session's turn has not read quiet; cleared otherwise. A closed wait also ends its check.
   * The player is told only of a change.
   */
  function syncPulse(): void {
    const open = waitOpen();
    if (!open) {
      quietNow = false;
      if (waitCheck !== null) clearTimer(waitCheck);
      waitCheck = null;
    }
    const on = pulse !== null && open && inFlight === 0 && !quietNow;
    if (on === pulseOn) return;
    pulseOn = on;
    options.player.fill(on ? pulse : null);
  }

  function armWaitCheck(): void {
    if (waitCheck !== null || pulse === null) return;
    waitCheck = setTimer(checkWait, WAIT_CHECK_MS);
  }

  /**
   * The wait's check, every 5 seconds while it is open: the binding is read, which closes a wait
   * whose session ended or changed, and past the grace the quiet window, since a session can end a
   * turn with no Stop. The pulse is off while the window reads quiet and on again once it does not.
   * A check that throws is logged and still armed again while the wait is open, so one failed check
   * costs one interval.
   */
  function checkWait(): void {
    waitCheck = null;
    try {
      const current = bound();
      if (current !== null && waiting() && now() - graceFrom >= QUIET_GRACE_MS) {
        quietNow = options.quiet(current.sessionId);
      }
      syncPulse();
    } catch {
      options.log(`voice: the wait's check failed for thread ${threadId}`);
    } finally {
      // Read through `prune`, which tells the player nothing, so nothing here can throw to the timer.
      if (waitOpen()) armWaitCheck();
    }
  }

  function onEnd(event: Extract<TurnEvent, { kind: "end" }>): void {
    // Only the operator's end gives the floor back, as only the operator's start takes it.
    const operator = options.gate.classOf(event.speakerId) === "operator";
    if (!operator) return;
    floor = false;
    const spoke = event.text !== "" && event.lost !== true;
    // A stop phrase over a reading. `stopped` has already cancelled the speech and dropped the
    // replies held behind this turn, so nothing pending is left to remember. The turn is the
    // transcript's and the ring's, the stopped line answers it as a helper's answer would, and it
    // goes to nothing else: an open ASK stays open for the turn that answers it.
    if (stop === event.turn) {
      stop = null;
      speakerId = event.speakerId;
      post("operator", options.names(speakerId).speaker, event.text);
      tier.stopHeard(event.turn, event.text);
      tier.speak(STOPPED_LINE, "answer").catch(() => {});
      return;
    }
    // A backchannel over the persona's speech is the transcript's and nothing else's: posted as
    // every operator turn is, kept out of the ring, and neither ranked nor handed off, so an open
    // ASK stays open for the turn that answers it. The replies held through it are still spoken.
    // Nothing pending is remembered here: the persona is still speaking, so a reply whose speak
    // settled may be mostly unheard, and the next full end's cut reading is what decides it.
    if (backchannel === event.turn) {
      backchannel = null;
      for (const text of held.splice(0)) speakReply(text);
      if (spoke) post("operator", options.names(event.speakerId).speaker, event.text);
      return;
    }
    // Ahead of every reader of the ring for this turn: the replies the operator heard through are
    // the persona's own words by now. The barge-in rule's discard ran before this end reached the
    // bridge, since it subscribed first, and has already dropped what this turn cut off.
    commitSaid();
    // Whether this turn answers a question the persona asked, read before the held replies are
    // spoken: one of them may itself ask, and that question is answered by the next turn.
    const answering = askOpen && spoke;
    if (answering) askOpen = false;
    // A stop phrase while the wait is open reached here with no verdict, so nothing was being
    // read: only the session can stop its own work, and the turn goes to it unranked. A reply held
    // behind this turn is not a reading, so it is spoken after the hand-off.
    const passedOn = spoke && !answering && isStopPhrase(event.text) && waiting();
    if (!passedOn) for (const text of held.splice(0)) speakReply(text);
    speakerId = event.speakerId;
    if (spoke) {
      post("operator", options.names(speakerId).speaker, event.text);
      if (speaker !== null) {
        // The new hold is taken before the old one is released, so the keeper's kept entry moves
        // to the new deadline rather than being stopped and restarted with an immediate typing call.
        const next = options.hold(threadId, now() + options.holdMs);
        releaseHold();
        releaseTyping = next;
      }
    }
    // Every end is the turn's last, so the answer is whole here and goes to the session at once. A
    // lost or empty end answers nothing and leaves the ASK open for the turn that does.
    if (answering) {
      deliverAnswer(event.turn, event.text, event.tone);
      return;
    }
    if (passedOn) {
      tier.handOffUnranked(event.turn, event.text, event.tone);
      for (const text of held.splice(0)) speakReply(text);
      return;
    }
    tier.take(event);
  }

  return {
    take(event) {
      try {
        if (event.kind === "end") {
          onEnd(event);
          return;
        }
        // Only the operator holds the floor: a participant's start neither holds a reply back nor
        // reaches the tier.
        if (options.gate.classOf(event.speakerId) !== "operator") return;
        if (event.kind === "start") floor = true;
        tier.take(event);
      } catch {
        options.log(`voice: a turn event failed in the bridge for thread ${threadId}`);
      }
    },
    reply(sessionId, text) {
      try {
        const current = bound();
        if (current === null || current.sessionId !== sessionId || openTurn !== sessionId) return;
        // A reply held behind the operator's floor has still arrived, so it ends the hold now and
        // no hand-off line is spoken over the operator for it.
        if (floor) {
          tier.clearHold();
          held.push(text);
        } else speakReply(text);
      } catch {
        options.log(`voice: a reply from session ${sessionId} could not be spoken`);
      }
    },
    turnOpened(sessionId) {
      try {
        const current = bound();
        if (current === null || current.sessionId !== sessionId) return;
        // After `bound()` the queue holds this session's hand-offs alone, and the signal arrives
        // synchronously after every delivery it follows, so it takes the whole queue.
        if (queue.length > 0) {
          queue.length = 0;
          openTurn = sessionId;
          return;
        }
        // Nothing to take. With a hand-off turn open this is typed text injected into it, which
        // leaves it open, unless the registry reads the turn quiet: then the turn ended without a
        // Stop, and this signal starts the turn that closes it.
        if (openTurn === sessionId && options.quiet(sessionId)) {
          openTurn = null;
          syncPulse();
        }
      } catch {
        options.log(`voice: a prompt signal from session ${sessionId} could not be read`);
      }
    },
    turnClosed(sessionId) {
      if (openTurn !== sessionId) return;
      openTurn = null;
      syncPulse();
    },
    cutIn(turn, cut) {
      // With nothing speaking, every pending line has settled and played out, so it is the
      // persona's words before the cancel can drop it. The cancel then has nothing to discard
      // but is still what tells the speaker and the tier the turn is a long one.
      if (!cut) commitSaid();
      speaker?.cancel();
      cancelled = true;
      tier.cutIn(turn);
    },
    heldShort(turn) {
      backchannel = turn;
    },
    stopped(turn) {
      speaker?.cancel();
      cancelled = true;
      held.length = 0;
      tier.cutIn(turn);
      stop = turn;
    },
    speaking: () => !cancelled && inFlight > 0,
    leave() {
      // The cancel drops the pending replies with the speech.
      speaker?.cancel();
      tier.leave();
      queue.length = 0;
      openTurn = null;
      floor = false;
      held.length = 0;
      askOpen = false;
      backchannel = null;
      stop = null;
      releaseHold();
      syncPulse();
    },
  };
}
