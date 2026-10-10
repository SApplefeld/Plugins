// The slow tier bridge: one per joined channel, standing between the transcriber, the fast tier
// and the session bound to the thread `voice on` was typed in. It hands a turn the fast tier
// cannot answer to that session as a relay event carrying the ring's lines since the last
// hand-off, speaks the session's replies from the turn that takes a hand-off until that turn ends,
// routes the operator's answer to an ASK straight back to the session, and posts every spoken turn
// to the thread as text, so the transcript is readable afterwards. The typing line is held from a
// turn's end until the first frame of what answers it.
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
import type { FastTier, Remember, TierSpeaker } from "./fast.ts";
import type { Player } from "./player.ts";
import { conversationLine } from "./rank.ts";
import type { LineNames } from "./rank.ts";
import type { Speaker } from "./speaker.ts";
import type { TurnEvent } from "./transcriber.ts";
import { wordCount } from "./transcriber.ts";

/** Spoken in place of an answer when the turn had no session to go to. */
export const CANNOT_REACH_LINE =
  "I cannot reach my session right now, so that question is not answered here. The thread says why.";

/** Closes a spoken reply cut at the word bound. */
export const REST_IN_THREAD_LINE = "The rest is in the thread.";

/** The session bound to the thread, as far as the bridge needs it. */
export type BridgeSession = { sessionId: string; processToken: string; state: SessionState };

/** What the fast tier's factory is handed: the names for its lines and the bridge's binding. */
export type TierBinding = {
  /** The two names as they read now, for the operator whose turn the tier is weighing. */
  names: () => LineNames;
  speaker: TierSpeaker | null;
  player: Pick<Player, "play">;
  handOff: (turn: string) => void;
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
  /** `CHANNEL_VOICE_MAX_SPOKEN_WORDS`: past this many words a reply is cut and closed. */
  maxSpokenWords: number;
  /** The joined channel's player, wrapped so the first frame of an answer releases the typing line. */
  player: Pick<Player, "play">;
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
  /**
   * `CHANNEL_VOICE_EAGER_SETTLE_MS`: how long an answer to an ASK whose turn ended eagerly is held
   * for a resume before it is handed off.
   */
  eagerSettleMs: number;
  log: (message: string) => void;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
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
   * The barge-in rule's reading that `turn` is a short turn spoken over speech the player held, a
   * backchannel: its end, which follows this call, is posted and neither ranked nor handed off,
   * unless the turn is the held answer to an ASK, whose end is still the answer.
   */
  heldShort: (turn: number) => void;
  /** Whether a speech handed to the speaker has not settled: the persona is mid-reply. */
  speaking: () => boolean;
  /** The channel is left: the speaker is cancelled, the tier cleared, and nothing stays pending. */
  leave: () => void;
};

export function createVoiceBridge(options: VoiceBridgeOptions): VoiceBridge {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  const { threadId } = options;
  // Hand-offs delivered and not yet taken by a prompt signal, oldest first, each the session it
  // went to.
  const queue: string[] = [];
  // The session whose turn took a hand-off, or null while no hand-off turn is open. Every reply
  // that turn sends is spoken, and its close leaves nothing open until the next signal that takes.
  let openTurn: string | null = null;
  // Whether the operator holds the floor: a turn started and not yet ended.
  let floor = false;
  // Replies that arrived while the operator held the floor, spoken in order at the turn's end.
  const held: string[] = [];
  // A spoken reply that asked: the operator's next spoken turn answers it directly.
  let askOpen = false;
  // The answer to an ASK not yet handed off: the answering turn's number, its latest text, and the
  // settle timer an eager end starts, or null. Held so a resume of that turn within the settle keeps
  // it the answer and the turn's final end hands it off whole, once. A resume after the settle has
  // handed it off finds nothing held, and the rest of the turn is an ordinary turn.
  let answer: { turn: number; text: string; settle: NodeJS.Timeout | null } | null = null;
  // The turn the barge-in rule read as a backchannel over held speech, or null. Set just ahead of
  // that turn's end and cleared by it.
  let backchannel: number | null = null;
  let releaseTyping: (() => void) | null = null;
  // The account whose turn the tier is weighing, for the hand-off event's sender.
  let speakerId = "";
  // The thread posts in flight, chained so a line's messages land in order behind the line before.
  let posting: Promise<void> = Promise.resolve();

  function session(): BridgeSession | null {
    try {
      return options.session();
    } catch {
      return null;
    }
  }

  /**
   * The bound session the queue answers to now, or null with the queue cleared where the thread's
   * session is gone or ended. A hand-off delivered to a session no longer bound leaves with it, so
   * a session that ends with a hand-off open never has that hand-off taken by its successor's turn.
   */
  function bound(): BridgeSession | null {
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

  // The speaker the tier is handed: each line is posted to the thread before it is spoken, so the
  // post never depends on the speech service answering.
  let voice: Speaker | null = null;
  // Speeches handed to the speaker and not yet settled, the persona being mid-reply. The barge-in
  // rule reads it to tell a backchannel over the persona from a turn of the operator's own.
  let inFlight = 0;
  // The persona lines spoken and not yet remembered, in speech order, each under the kind it is
  // remembered as: the tier's answer or the session's reply. A speak settles when its last frame
  // reaches the player, not when the operator has heard it, so a line is appended to the ring at
  // the next operator turn's end, once its speech has settled, and before anything reads the ring
  // for that turn. A cancel before then drops every pending line: a long turn that cut the persona
  // short, whose stop discarded whatever of them was still unheard, or a leave. A long turn after
  // the persona finished remembers them first, in `cutIn`. A line that names no kind, a holding
  // line or the cannot-reach line, is never pending.
  const pending: Array<{ text: string; writer: Remember; settled: boolean }> = [];
  const speaker: TierSpeaker | null =
    options.speaker === null
      ? null
      : {
          speak: async (text, history, remember, turn) => {
            post("persona", options.names(speakerId).session, text);
            // Pending from the moment it is handed to the speaker, so a cancel while it speaks
            // drops it; settled once the speaker is done with it, which is what lets the next
            // turn's end remember it. An entry a cancel already dropped is flagged to no effect.
            const entry = remember === undefined ? null : { text, writer: remember, settled: false };
            if (entry !== null) pending.push(entry);
            inFlight += 1;
            // The voice's own contract is to settle without rejecting; this is the guard behind it,
            // so a tier waiting on the line is never left hanging by a broken speaker.
            try {
              // A session reply is in the thread from the outbound router already, so the speech
              // service's fallback must not post it a second time; a fast answer has no other copy.
              // The operator's latest turn, where the tier names one, goes to the speech service.
              await voice?.speak(text, history, { inThread: remember === "session reply", turn });
            } catch {
              options.log(`voice: the speaker failed on a line for thread ${threadId}`);
            } finally {
              inFlight -= 1;
              if (entry !== null) entry.settled = true;
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
      tier.said(entry.text, entry.writer);
    }
  }
  // The tier's names are the current speaker's, set at each operator end before the tier takes it.
  const tier = options.tier({ names: () => options.names(speakerId), speaker, player, handOff, forget });
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

  function handOff(turn: string): void {
    const bound = session();
    try {
      if (bound === null || bound.state === "ended") {
        if (bound !== null) void options.notice(threadId, ENDED_NOTICE).catch(() => {});
        options.log(`voice: a hand-off had no live session for thread ${threadId}`);
        speakLine(CANNOT_REACH_LINE);
        return;
      }
      const text = [...linesBefore(turn), turn].join("\n");
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
        return;
      }
      queue.push(bound.sessionId);
      tier.ring.markNewest();
    } catch {
      options.log(`voice: handing a turn to session ${bound?.sessionId ?? "none"} failed`);
      speakLine(CANNOT_REACH_LINE);
    }
  }

  /** The reply as it is spoken: whole inside the word bound, else cut there and closed. */
  function bounded(text: string): string {
    if (wordCount(text) <= options.maxSpokenWords) return text;
    const words = text.split(/\s+/).filter((word) => word !== "");
    return `${words.slice(0, options.maxSpokenWords).join(" ")} ${REST_IN_THREAD_LINE}`;
  }

  function speakReply(text: string): void {
    // Open from the moment the question is handed to the speaker, never from when the reply was
    // queued behind the operator's turn: the words that ended that turn were not an answer to a
    // question not yet asked. A later reply with no ask of its own leaves an open ask standing,
    // since the operator still owes the answer: only the answering turn or a leave clears it.
    if (findAskLine(text) !== null) askOpen = true;
    const spoken = bounded(text);
    // With no voice there is nothing to hear and nothing a cut-in could stop, so the reply is the
    // persona's words at once. With one, the speaker's wrapper holds it until it has been heard.
    if (speaker === null) {
      tier.said(spoken);
      return;
    }
    tier.speak(spoken, "session reply").catch(() => {});
  }

  /** Stops the held answer's settle, where one is running. */
  function stopSettle(): void {
    if (answer === null || answer.settle === null) return;
    clearTimer(answer.settle);
    answer.settle = null;
  }

  /** Hands the held answer off, once: into the ring as the answer, then to the session. */
  function deliverAnswer(): void {
    if (answer === null) return;
    stopSettle();
    const { turn, text } = answer;
    answer = null;
    // The answer reaches the session even where the tier fails to take its line.
    try {
      tier.answeredAsk(turn, text);
    } finally {
      handOff(text);
    }
  }

  /**
   * Takes the answering turn's latest end: a final end hands the answer off at once, and an eager
   * one starts the settle, which hands it off unless a resume of the turn stops it first.
   */
  function settleOrDeliver(eager: boolean): void {
    if (answer === null) return;
    if (!eager) {
      deliverAnswer();
      return;
    }
    // One settle per answer: an eager end with no resume before it restarts the one running.
    stopSettle();
    answer.settle = setTimer(() => {
      try {
        deliverAnswer();
      } catch {
        options.log(`voice: handing an answer off failed in the bridge for thread ${threadId}`);
      }
    }, options.eagerSettleMs);
  }

  function onEnd(event: Extract<TurnEvent, { kind: "end" }>): void {
    // Only the operator's end gives the floor back, as only the operator's start takes it.
    const operator = options.gate.classOf(event.speakerId) === "operator";
    if (!operator) return;
    floor = false;
    const spoke = event.text !== "" && event.lost !== true;
    // The held answer's turn ending again after a resume: it is still the answer, so it is neither
    // read as a backchannel nor ranked, and the open ASK it already closed is not read again.
    const resumedAnswer = answer !== null && answer.turn === event.turn;
    if (resumedAnswer && backchannel === event.turn) backchannel = null;
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
    const answering = !resumedAnswer && askOpen && spoke;
    if (answering) askOpen = false;
    for (const text of held.splice(0)) speakReply(text);
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
    // The answer is held rather than handed off here: an eager end may be withdrawn by a resume,
    // and the turn's next end then replaces the text. A lost or empty end keeps the text held, so
    // the answer is never dropped.
    if (resumedAnswer) {
      if (spoke && answer !== null) answer.text = event.text;
      settleOrDeliver(spoke && event.eager === true);
      return;
    }
    if (answering) {
      answer = { turn: event.turn, text: event.text, settle: null };
      settleOrDeliver(event.eager === true);
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
        if (answer !== null) {
          // Flux starts a new turn only after the held answer's turn has ended for good, so the
          // answer is whole and goes ahead of the new turn. A resume of its own turn stops the
          // settle, and the turn's next end decides again.
          // A failed hand-off is logged and never keeps the new turn's start from the tier.
          if (event.kind === "start" && answer.turn !== event.turn) {
            try {
              deliverAnswer();
            } catch {
              options.log(`voice: handing an answer off failed in the bridge for thread ${threadId}`);
            }
          }
          else if (event.kind === "resumed" && answer.turn === event.turn) stopSettle();
        }
        if (event.kind === "start" || event.kind === "resumed") floor = true;
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
        // no holding line is spoken over the operator for it.
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
        if (openTurn === sessionId && options.quiet(sessionId)) openTurn = null;
      } catch {
        options.log(`voice: a prompt signal from session ${sessionId} could not be read`);
      }
    },
    turnClosed(sessionId) {
      if (openTurn === sessionId) openTurn = null;
    },
    cutIn(turn, cut) {
      // With nothing speaking, every pending line has settled and played out, so it is the
      // persona's words before the cancel can drop it. The cancel then has nothing to discard
      // but is still what tells the speaker and the tier the turn is a long one.
      if (!cut) commitSaid();
      speaker?.cancel();
      tier.cutIn(turn);
    },
    heldShort(turn) {
      backchannel = turn;
    },
    speaking: () => inFlight > 0,
    leave() {
      // The cancel drops the pending replies with the speech.
      speaker?.cancel();
      tier.leave();
      queue.length = 0;
      openTurn = null;
      floor = false;
      held.length = 0;
      askOpen = false;
      // An answer still settling leaves with the channel, never handed off.
      stopSettle();
      answer = null;
      backchannel = null;
      releaseHold();
    },
  };
}
