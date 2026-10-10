// The fast tier: a finished spoken turn is ranked by Jev as answer or hand off, a small Claude
// model answers the turn at once through the `Speaker`, and a turn the session must take is handed
// off and held: a thinking line is spoken only where the session's reply has not reached the tier
// by the first hold moment, and a still-looking line only where it has not by the second. The
// reply, a cut-in, a leave or the next hand-off clears the hold. The memory ring the tier answers
// from is here too, since it is the one state the tier and the session's bridge share. The tier
// appends the operator's turns itself; a persona line, its own answer or the session's reply, is
// appended through `said` by the bridge once the operator has heard it through, which only the
// bridge can tell.
//
// Each turn takes one direction and never none. Every failure of the screen, of Jev or of the model
// hands the turn off and holds it, so the persona's session is the floor and nothing here
// throws to its caller or drops a turn in silence. A speech the speech service fails is not a
// hand-off: the bridge posted the line to the thread before the speech was asked for, and with the
// mirror off the speaker's own fallback posts the unspoken words there instead. A turn withdrawn by
// a `resumed` or by another turn's long cut-in (`cutIn`) is the one exception to the rule: its work
// is discarded, it is neither answered nor handed off, and a hand-off already delivered for it
// stands.
//
// Three absences each narrow what the tier does, and none stops it. With no judge key, no turn is
// ranked and every turn hands off. With no fast key, or with no speaker, every turn hands off too,
// and none is ranked, since an answer that cannot be spoken belongs to the session's thread reply
// and the ranking would decide nothing; with no speaker there is no holding line either.
//
// What leaves the machine from here is the ring and the turn, screened for secrets before the Jev
// call and again before the model call; a hit makes neither call, and the turn never enters the
// ring, so it reaches neither the speech service nor a later call. Nothing logged carries the key,
// the turn, a line of the ring, a reply, a response body or the turn's audio: a failure is logged by
// its kind or status alone, and a turn by its number.
//
// The operator's latest turn, its text and the audio cut at its end, goes with every speech the
// tier asks for, so the speech service takes its delivery from how the operator just spoke. The
// next turn's end replaces it, a resume of a turn no answer was spoken to clears it, as it takes the
// turn's line out of the ring, and a screened turn holds none, so its text never reaches the
// service. An operator turn that answers an ASK is the latest turn too, though the bridge hands it
// off unranked; a resume of it after the bridge's settle has handed it off clears it and leaves its
// line in the ring.
import { SECRET_SCREEN, createJevClient } from "../jev/client.ts";
import type { JevFetch, JevResult } from "../jev/client.ts";
import type { Player } from "./player.ts";
import { STILL_LOOKING_LINES, THINKING_LINES, systemPrompt } from "./prompt.ts";
import { RANK_QUESTIONS, RANK_REPEAT_LOG, decide, rankState } from "./rank.ts";
import type { LineNames, RankQuestion, RankThresholds } from "./rank.ts";
import { replyKind } from "./reply-check.ts";
import type { SpokenLine, SpokenTurn } from "./speaker.ts";
import type { TurnEvent } from "./transcriber.ts";

/** The one host an answer is ever asked of. A constant, so no argument or setting can redirect it. */
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** The Messages API version every request names. */
export const ANTHROPIC_VERSION = "2023-06-01";

/** The most output tokens one answer may take: a few spoken sentences. */
export const ANSWER_MAX_TOKENS = 200;

/** How long one model call may take before the turn is handed off instead. Never retried. */
export const ANSWER_TIMEOUT_MS = 5_000;

/**
 * The one request the model is asked through, as the narrowest shape a test fake needs to answer.
 * The global `fetch` satisfies it, and the default is that.
 */
export type AnthropicFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    /** A redirect fails the call, so a 307 or 308 can never re-POST the conversation to another host. */
    redirect: "error";
  },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** One message of the model's conversation: the ring's lines folded into alternating roles. */
export type AnthropicMessage = { role: "user" | "assistant"; content: string };

/** Who is appending a line: the operator's turn, the model's answer, or the session's reply. */
export type RingWriter = "turn" | "answer" | "session reply";

/** The kind a spoken persona line is remembered under once the operator has heard it through. */
export type Remember = Extract<RingWriter, "answer" | "session reply">;

/**
 * The speaker the tier is handed: `Speaker` with a third argument naming whether, and as what, the
 * line is remembered once heard through. A line that names none, a holding line or the bridge's
 * cannot-reach line, is spoken and never remembered. The bridge's wrapper speaker reads it, since a
 * speak settles when the last frame reaches the player rather than when it has played, and only the
 * bridge sees the operator's next turn, which is when a line counts as heard. The fourth argument is
 * the operator's latest turn and its audio, which the wrapper passes on to the speaker.
 */
export type TierSpeaker = {
  speak: (text: string, history: readonly SpokenLine[], remember?: Remember, turn?: SpokenTurn) => Promise<void>;
  cancel: () => void;
};

/**
 * The last `capacity` spoken lines, held in process only, with a high-water mark: how many lines
 * from the oldest a hand-off has already carried to the session. `sinceMark` is what the next
 * hand-off carries, and `markNewest` moves the mark past everything held. Dropping the oldest line
 * moves the mark with it, so a carried line never reads as uncarried.
 *
 * The ring is the one way a line is remembered, and the secret screen sits in its `append`, so no
 * writer can put a line past it: a screened line is never sent on as remembered conversation, to
 * Jev, the model or the speech service's history. The turn's own text still reaches the session
 * on a hand-off, and a screened answer is still spoken.
 */
export type MemoryRing = {
  /**
   * Holds the line, or refuses one whose text matches the secret screen and says so by the writer's
   * kind alone. Returns whether the line was held.
   */
  append: (line: SpokenLine, writer: RingWriter) => boolean;
  /** Takes one line out, found by identity; a line already dropped is nothing to remove. */
  remove: (line: SpokenLine) => void;
  lines: () => readonly SpokenLine[];
  sinceMark: () => readonly SpokenLine[];
  markNewest: () => void;
  clear: () => void;
};

export function createMemoryRing(capacity: number, log: (message: string) => void = () => {}): MemoryRing {
  const held: SpokenLine[] = [];
  let carried = 0;
  return {
    append(line, writer) {
      if (SECRET_SCREEN.test(line.text)) {
        log(`voice: ${writer === "answer" ? "an" : "a"} ${writer} matched the secret screen, so it is not remembered`);
        return false;
      }
      held.push(line);
      if (held.length > capacity) {
        held.shift();
        if (carried > 0) carried -= 1;
      }
      return true;
    },
    remove(line) {
      const index = held.indexOf(line);
      if (index < 0) return;
      held.splice(index, 1);
      if (index < carried) carried -= 1;
    },
    lines: () => [...held],
    sinceMark: () => held.slice(carried),
    markNewest() {
      carried = held.length;
    },
    clear() {
      held.length = 0;
      carried = 0;
    },
  };
}

/**
 * The ring plus the turn as the Messages API takes them: alternating `user` and `assistant`
 * messages, consecutive lines of one role joined by a line break, the first message a `user` one,
 * so a leading persona line is dropped.
 */
export function toMessages(lines: readonly SpokenLine[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  for (const line of lines) {
    const role = line.role === "user" ? "user" : "assistant";
    const last = messages[messages.length - 1];
    if (last === undefined) {
      if (role === "user") messages.push({ role, content: line.text });
      continue;
    }
    if (last.role === role) {
      last.content = `${last.content}\n${line.text}`;
      continue;
    }
    messages.push({ role, content: line.text });
  }
  return messages;
}

/**
 * The reply text read out of a response body: the `text` of every `text` block of `content`,
 * joined, or null where the body is malformed, meaning not JSON, `content` not a list, or a text
 * block whose `text` is not a string. The body is never returned or logged past this, since it is
 * the vendor's and quotes the conversation back.
 */
export function readReply(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const content = (parsed as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const block of content as unknown[]) {
    if (typeof block !== "object" || block === null) return null;
    const { type, text } = block as { type?: unknown; text?: unknown };
    if (type !== "text") continue;
    if (typeof text !== "string") return null;
    parts.push(text);
  }
  return parts.join("");
}

/** The model behind an answer: its key, never logged in whole or in part, and the model name. */
export type FastModel = {
  apiKey: string;
  model: string;
  /** Injected so a test drives the call without a network. */
  fetch?: AnthropicFetch;
};

export type FastTierOptions = {
  /**
   * The names the buffered line form and the system prompt carry, the operator's display name and
   * the session's, as they read now. Read at each use, so a renamed session is named by its new
   * name from the next turn on.
   */
  names: () => LineNames;
  thresholds: RankThresholds;
  /** How many spoken lines the ring holds. */
  memoryTurns: number;
  /** The Jev key, or null where every turn hands off unranked. */
  judge: { apiKey: string; fetch?: JevFetch } | null;
  /** The model, or null where a turn ranked as answerable hands off instead. */
  fast: FastModel | null;
  /** The voice, or null where nothing is spoken and every turn hands off. */
  speaker: TierSpeaker | null;
  /**
   * The joined channel's player. The tier hands back a wrapper of it, `player` on the result, which
   * the speaker is given, so the first audio frame of each turn is seen here and timed.
   */
  player: Pick<Player, "play">;
  /**
   * Told the turn's text once per hand-off, at the hand-off, after the thinking line is queued
   * where `holdFirstMs` is zero. The bridge delivers it to the session with the ring's lines past
   * the mark, and moves the mark.
   */
  handOff: (turn: string) => void;
  /**
   * `CHANNEL_VOICE_HOLD_FIRST_MS`: how long after a hand-off the thinking line waits for the
   * session's reply before it is spoken. Zero speaks it at the hand-off.
   */
  holdFirstMs: number;
  /**
   * `CHANNEL_VOICE_HOLD_SECOND_MS`: how long after a hand-off the still-looking line waits for the
   * reply. Greater than `holdFirstMs`, which the config refuses otherwise.
   */
  holdSecondMs: number;
  /**
   * Told the text of an answer whose turn was withdrawn while its speech was in flight, so the
   * bridge forgets it: the question has left the ring, and the answer must not be remembered alone.
   */
  forget?: (text: string) => void;
  log: (message: string) => void;
  /** The clock each turn is timed on. Injected so a test reads a figure without waiting. */
  now?: () => number;
  /** The hold's timers. Injected so a test drives its two moments without waiting. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
  /** The operator's audio cut at turn `turn`'s end, read as the tier takes that end, or null. */
  turnAudio: (turn: number) => Buffer | null;
};

export type FastTier = {
  /**
   * Takes one turn event. An `end` with words is ranked, an `end` with none, a lost one included,
   * is nothing, a `resumed` withdraws, and the rest are ignored.
   */
  take: (event: TurnEvent) => void;
  /**
   * Speaks for the bridge, the session's answer among other things, through the same speaker and
   * in queue order with the tier's own speech, so no frame of it is ever timed as a turn's. Section
   * 5 speaks through this and nothing else. `remember` passes through to the speaker as the tier's
   * own answers pass `answer`. Resolves as the speaker does, at once with no speaker. Any speech
   * asked for here clears the hold: the bridge speaks the session's reply and the cannot-reach line
   * alone, and after either the turn waits on nothing a holding line could cover.
   */
  speak: (text: string, remember?: Remember) => Promise<void>;
  /**
   * Appends a persona line the operator has heard through, the session's reply by default or the
   * fast model's answer under `answer`, and returns whether it was remembered. One that matches the
   * secret screen is refused by the ring and logged by a fixed line; it was still spoken, so the
   * ring and what was said differ by that line, by design, to keep a secret off the vendors the
   * ring is sent to. The bridge calls this at the operator's next turn's end, so a line a cut-in
   * stopped short never arrives here.
   */
  said: (text: string, writer?: Remember) => boolean;
  /**
   * A long cut-in by turn `turn`: drops the work in flight for every other turn, so a model call
   * is aborted and a pending ranking is discarded on arrival, while the cutting-in turn itself is
   * left to be ranked and answered whether its end was taken before this call or after it. A
   * hand-off already delivered stands, and its hold is cleared unless it is the cutting-in turn's.
   */
  cutIn: (turn: number) => void;
  /**
   * Operator turn `turn`, which answers an ASK and which the bridge hands off unranked: its line
   * joins the ring, and it becomes the latest turn, with the audio cut at its end. One the ring
   * refuses as screened leaves no latest turn.
   */
  answeredAsk: (turn: number, text: string) => void;
  /**
   * Clears the hold without speaking: the session's reply has arrived and the bridge holds it
   * behind the operator's floor, so no holding line is owed for it.
   */
  clearHold: () => void;
  /**
   * Drops every turn's work, clears the hold and empties the ring: the tier forgets the
   * conversation. The speaker is the caller's to cancel on a leave, which Section 5 binds; the tier
   * never calls it.
   */
  leave: () => void;
  /** The ring, for the bridge to read past the mark and move it. */
  ring: Pick<MemoryRing, "lines" | "sinceMark" | "markNewest">;
  /** The player the speaker is given: the channel's, with each turn's first frame timed on the way. */
  player: Pick<Player, "play">;
};

/** How one turn ended up, for the timing line. */
type Outcome = "answered" | "handed off";

/**
 * One finished turn and its work: the user line it put in the ring, the conversation it is answered
 * over (the ring before it plus that line), the operator's audio of it, when it ended, the
 * controller that aborts its model call, and the flags that keep a cancelled turn from being
 * answered or handed off, each of the two holding lines from being spoken twice for one turn, and a
 * withdrawn turn's line from being pulled from under an answer already spoken to it. `speaking` is
 * the answer's text while its speech is in flight, so a withdrawal then can name it to the bridge.
 */
type Turn = {
  number: number;
  text: string;
  line: SpokenLine;
  history: readonly SpokenLine[];
  audio: Buffer | null;
  endedAt: number;
  controller: AbortController;
  cancelled: boolean;
  thinkingSpoken: boolean;
  stillLookingSpoken: boolean;
  answered: boolean;
  done: boolean;
  speaking: string | null;
};

/**
 * One speech queued at the speaker, in queue order: a turn's, timed by its first frame, or the
 * bridge's, which holds its place and is never charged. `charged` is set by the first frame that
 * reaches the player while the entry is at the head of the queue.
 */
type Awaiting = { turn: Turn | null; outcome: Outcome | null; charged: boolean };

/** The failure kind a thrown fetch reports: the timeout signal's own name, or a network failure. */
function thrownKind(error: unknown): string {
  return error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network";
}

/** True when any of the texts matches the secret screen. Run over every text, whole. */
function screened(texts: readonly string[]): boolean {
  return texts.some((text) => SECRET_SCREEN.test(text));
}

/**
 * One model call over the conversation. Settles on every path: the reply text, or the failure
 * kind, which is `cancelled` where the turn's own controller aborted it.
 */
async function askModel(
  fast: FastModel,
  session: string,
  lines: readonly SpokenLine[],
  cancel: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; kind: string }> {
  const request: AnthropicFetch = fast.fetch ?? globalThis.fetch;
  let body: string;
  try {
    const response = await request(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": fast.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: fast.model,
        max_tokens: ANSWER_MAX_TOKENS,
        system: systemPrompt(session),
        messages: toMessages(lines),
      }),
      signal: AbortSignal.any([AbortSignal.timeout(ANSWER_TIMEOUT_MS), cancel]),
      redirect: "error",
    });
    if (!response.ok) return { ok: false, kind: `http ${String(response.status)}` };
    body = await response.text();
  } catch (error) {
    if (cancel.aborted) return { ok: false, kind: "cancelled" };
    return { ok: false, kind: thrownKind(error) };
  }
  const reply = readReply(body);
  if (reply === null) return { ok: false, kind: "malformed" };
  const text = reply.trim();
  if (text === "") return { ok: false, kind: "empty" };
  return { ok: true, text };
}

export function createFastTier(options: FastTierOptions): FastTier {
  const { names, thresholds, speaker, fast, log } = options;
  const now = options.now ?? Date.now;
  const ring = createMemoryRing(options.memoryTurns, log);
  /** The turns whose records are still needed, by the transcriber's turn number. */
  const open = new Map<number, Turn>();
  /**
   * The speeches queued at the speaker, oldest first. The speaker plays them in this order, so the
   * head is the one the next frame belongs to; it leaves the queue when its speak settles.
   */
  const awaiting: Awaiting[] = [];
  // A pending holding line never keeps the broker's process alive at shutdown.
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref());
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  /** Each set's next line: the two rotate apart, so one set's turn never moves the other's. */
  let nextThinking = 0;
  let nextStillLooking = 0;
  /**
   * The hold: the handed-off turn it is for and the timers of its lines still to speak, or null.
   * One at a time, the newest hand-off's, so one wait never hears two schedules.
   */
  let hold: { turn: Turn; timers: NodeJS.Timeout[] } | null = null;
  /** The turn whose text and audio go with every speech, or null where none does. */
  let latest: { number: number; text: string; audio: Buffer | null } | null = null;
  /** Counts ranking submissions, so no two ever share a key at the Jev client. */
  let submissions = 0;

  const player: Pick<Player, "play"> = {
    play(pcm) {
      // The first frame of the speech at the head charges it; the rest of that speech charge nothing.
      const head = awaiting[0];
      if (head !== undefined && !head.charged) {
        head.charged = true;
        if (head.turn !== null && head.outcome !== null) {
          const what = head.outcome === "answered" ? "first audio" : "holding line";
          log(`voice: turn ${head.outcome}, ${what} after ${String(Math.round(now() - head.turn.endedAt))}ms`);
        }
      }
      options.player.play(pcm);
    },
  };

  /**
   * Speaks through the speaker in queue order. A turn's speech is timed by its first frame; one
   * that settles with no frame, as one the speech service refused does, is logged as such. The
   * bridge's speech, with no turn, holds its place and is never charged.
   */
  function speak(
    voice: TierSpeaker,
    turn: Turn | null,
    outcome: Outcome | null,
    text: string,
    history: readonly SpokenLine[],
    remember?: Remember,
  ): Promise<void> {
    const entry: Awaiting = { turn, outcome, charged: false };
    awaiting.push(entry);
    const spokenTurn =
      latest === null || latest.audio === null ? undefined : { text: latest.text, audio: latest.audio };
    return voice.speak(text, history, remember, spokenTurn).then(() => {
      const index = awaiting.indexOf(entry);
      // An entry already gone left with `leave`, and its settling is nobody's news.
      if (index < 0) return;
      awaiting.splice(index, 1);
      if (!entry.charged && outcome !== null) log(`voice: turn ${outcome}, no audio reached the player`);
    });
  }

  /** Clears the hold, where one is armed: a timer still pending never fires. */
  function clearHold(): void {
    if (hold === null) return;
    for (const timer of hold.timers) clearTimer(timer);
    hold = null;
  }

  /**
   * Speaks the turn's next thinking line, or its next still-looking line, once per turn, over the
   * conversation the turn was handed off with. A turn withdrawn since its hand-off is not held.
   */
  function holdingLine(voice: TierSpeaker, turn: Turn, kind: "thinking" | "still looking"): void {
    if (turn.cancelled) return;
    let line: string;
    if (kind === "thinking") {
      if (turn.thinkingSpoken) return;
      turn.thinkingSpoken = true;
      line = THINKING_LINES[nextThinking];
      nextThinking = (nextThinking + 1) % THINKING_LINES.length;
    } else {
      if (turn.stillLookingSpoken) return;
      turn.stillLookingSpoken = true;
      line = STILL_LOOKING_LINES[nextStillLooking];
      nextStillLooking = (nextStillLooking + 1) % STILL_LOOKING_LINES.length;
    }
    void speak(voice, turn, "handed off", line, turn.history);
  }

  /**
   * Hands the turn off: arms the hold, then the callback. The hold replaces any earlier one and
   * times its two lines from this call, and a thinking line due at zero is queued here, before the
   * callback. A cancelled turn is neither held nor handed off. A throw out of the callback is the
   * bridge's defect, logged by turn number and ended here, so it reaches neither the Jev client's
   * handler nor the answer chain.
   */
  function handOff(turn: Turn): void {
    if (turn.cancelled) return;
    turn.done = true;
    clearHold();
    if (speaker === null) {
      // With nothing to speak through, the log line stands in for the hold, once per turn.
      if (!turn.thinkingSpoken) {
        turn.thinkingSpoken = true;
        log("voice: turn handed off, no speaker to hold the line");
      }
    } else {
      const voice = speaker;
      const armed: { turn: Turn; timers: NodeJS.Timeout[] } = { turn, timers: [] };
      if (options.holdFirstMs === 0) {
        holdingLine(voice, turn, "thinking");
      } else if (!turn.thinkingSpoken) {
        armed.timers.push(setTimer(() => holdingLine(voice, turn, "thinking"), options.holdFirstMs));
      }
      if (!turn.stillLookingSpoken) {
        armed.timers.push(
          setTimer(() => {
            // The last line of the hold: once it is spoken, nothing is left to clear.
            if (hold === armed) hold = null;
            holdingLine(voice, turn, "still looking");
          }, options.holdSecondMs),
        );
      }
      // A turn whose two lines were both spoken before this hand-off has nothing left to hold.
      if (armed.timers.length > 0) hold = armed;
    }
    try {
      options.handOff(turn.text);
    } catch {
      log(`voice: the hand-off callback threw turn=${String(turn.number)}`);
    }
  }

  /** Answers the turn, or hands it off where it cannot be answered or spoken. */
  async function answer(turn: Turn): Promise<void> {
    if (fast === null || speaker === null) {
      handOff(turn);
      return;
    }
    // The same screen the ranking ran, run again here so the model call never rests on it.
    if (screened(turn.history.map((line) => line.text))) {
      handOff(turn);
      return;
    }
    const result = await askModel(fast, names().session, turn.history, turn.controller.signal);
    if (turn.cancelled) return;
    if (!result.ok) {
      log(`voice: the fast answer failed (${result.kind}), so the turn is handed off`);
      handOff(turn);
      return;
    }
    // A reply that is the hand-off token, or that speaks about its own reach or takes back an earlier
    // line, is discarded unspoken and unremembered, and the turn goes to the session. The log names
    // the kind alone, never the reply.
    const held = replyKind(result.text);
    if (held !== null) {
      log(`voice: the fast answer was held back (${held}), so the turn is handed off`);
      handOff(turn);
      return;
    }
    // Handed over to be remembered as an answer once heard through: the speaker's wrapper holds it
    // until the operator's next turn ends, and a cut-in before then drops it, so an answer the
    // player had queued and never played is not the persona's words.
    turn.speaking = result.text;
    await speak(speaker, turn, "answered", result.text, turn.history, "answer");
    turn.speaking = null;
    if (turn.cancelled) return;
    turn.answered = true;
    turn.done = true;
  }

  const judge =
    options.judge === null
      ? null
      : createJevClient<RankQuestion, Turn>({
          apiKey: options.judge.apiKey,
          questions: RANK_QUESTIONS,
          repeatLog: RANK_REPEAT_LOG,
          ...(options.judge.fetch === undefined ? {} : { fetch: options.judge.fetch }),
          log,
          now,
          onResult: (_key, turn, result: JevResult<RankQuestion>) => {
            if (turn.cancelled) return;
            if (decide(result, thresholds) === "handoff") {
              handOff(turn);
              return;
            }
            // `answer` settles on every path.
            void answer(turn);
          },
        });

  /** A finished turn: into the ring, through the screen, and to the judge. */
  function ended(number: number, text: string): void {
    const endedAt = now();
    // A record for the same turn is an earlier end this one replaces, handled as a `resumed`
    // handles it: its work still open is withdrawn, its line leaves the ring unless an answer was
    // spoken to it, and each of its holding lines already spoken is not spoken again. Settled
    // records of other turns are no longer needed.
    const prior = open.get(number);
    if (prior !== undefined) {
      withdraw(prior);
      if (!prior.answered) ring.remove(prior.line);
    }
    for (const [key, held] of open) {
      if (key === number || held.done || held.cancelled) open.delete(key);
    }
    const before = ring.lines();
    const line: SpokenLine = { role: "user", text };
    // The ring refuses a screened turn, so its holding lines are spoken over the ring as it stood
    // and the next turn is ranked over a ring that holds nothing of it. The call decision screens
    // the turn and the ring together, which agree, since the ring holds no screened line.
    const held = ring.append(line, "turn");
    const hit = !held || screened(before.map((earlier) => earlier.text));
    const turn: Turn = {
      number,
      text,
      line,
      history: held ? [...before, line] : before,
      audio: options.turnAudio(number),
      endedAt,
      controller: new AbortController(),
      cancelled: false,
      thinkingSpoken: prior?.thinkingSpoken ?? false,
      stillLookingSpoken: prior?.stillLookingSpoken ?? false,
      answered: false,
      done: false,
      speaking: null,
    };
    open.set(number, turn);
    latest = held ? { number, text, audio: turn.audio } : null;
    if (hit) {
      log(`voice: a turn matched the secret screen, so it is handed off with no call made turn=${String(number)}`);
      handOff(turn);
      return;
    }
    // With no judge nothing can rank the turn. With no model or no speaker a turn ranked as
    // answerable hands off all the same, so the ranking would decide nothing and is not asked for.
    if (judge === null || fast === null || speaker === null) {
      handOff(turn);
      return;
    }
    // A key of its own per submission: the Jev client parks a second submission on one key behind
    // the first call, which would hold a resumed turn's new end behind its withdrawn one.
    submissions += 1;
    judge.submit(`${String(number)}/${String(submissions)}`, rankState(before, text, names()), turn);
  }

  /**
   * Drops the turn's work. A delivered hand-off stands, and so does an answer already spoken. An
   * answer still being spoken is named to the bridge, which forgets it: its question leaves the
   * ring with the turn, and the speech itself is the player's and the barge-in rule's to finish or
   * stop.
   */
  function withdraw(turn: Turn): void {
    if (turn.cancelled) return;
    turn.cancelled = true;
    turn.controller.abort();
    if (turn.speaking !== null) {
      options.forget?.(turn.speaking);
      turn.speaking = null;
    }
  }

  return {
    take(event) {
      if (event.kind === "end") {
        // A lost end has no final text, and an eager end can carry none: neither is a turn, so
        // neither is ranked, remembered or held.
        if (event.lost === true || event.text.trim() === "") return;
        ended(event.turn, event.text);
        return;
      }
      if (event.kind !== "resumed") return;
      const turn = open.get(event.turn);
      if (turn === undefined) {
        // An answer to an ASK has no record here and no answer spoken to it. The bridge holds it
        // through a resume, so a resume finds it here only after the settle handed it off, and then
        // clears it.
        if (latest?.number === event.turn) latest = null;
        return;
      }
      withdraw(turn);
      // The ring never holds a withdrawn half-turn: the line goes, and the resumed turn's end puts
      // the whole turn in. A line an answer was already spoken to stays, so the answer keeps what
      // it answered.
      if (!turn.answered) {
        ring.remove(turn.line);
        if (latest?.number === turn.number) latest = null;
      }
    },
    speak(text, remember) {
      clearHold();
      if (speaker === null) return Promise.resolve();
      return speak(speaker, null, null, text, ring.lines(), remember);
    },
    said(text, writer = "session reply") {
      return ring.append({ role: "persona", text }, writer);
    },
    answeredAsk(number, text) {
      const held = ring.append({ role: "user", text }, "turn");
      latest = held ? { number, text, audio: options.turnAudio(number) } : null;
    },
    cutIn(number) {
      // The cutting-in turn's own record is spared, whether its end was taken before this call or
      // arrives after it, so a long question is answered rather than withdrawn by its own cut-in.
      for (const turn of open.values()) {
        if (turn.number !== number && !turn.done) withdraw(turn);
      }
      if (hold !== null && hold.turn.number !== number) clearHold();
    },
    clearHold,
    leave() {
      clearHold();
      for (const turn of open.values()) withdraw(turn);
      open.clear();
      awaiting.length = 0;
      ring.clear();
      latest = null;
    },
    ring: { lines: ring.lines, sinceMark: ring.sinceMark, markNewest: ring.markNewest },
    player,
  };
}
