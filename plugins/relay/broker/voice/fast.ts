// The fast tier, the quick voice helper: a finished spoken turn is ranked by Jev as answer or hand
// off, a small Claude model answers the turn at once through the `Speaker`, speaking as the helper
// it is, and a turn the main model must take is handed off to its session. A hand-off that is news
// to the operator, the last turn the helper answered or handed off having been answered, takes one
// hand-off line once the session has the turn, spoken only where the session's reply has not
// reached the tier by the hold moment, and at the hand-off where that moment is zero. A hand-off
// straight after another takes none, and one that reaches no session takes none, since the bridge
// speaks its cannot-reach line instead. The reply, a cut-in, a helper's answer to a later turn or a
// leave clears a line still waiting. The memory ring the tier answers from is
// here too, since it is the one state the tier and the session's bridge share. The tier appends the
// operator's turns itself; the helper's answer or the main model's reply is appended through `said`
// by the bridge once the operator has heard it through, which only the bridge can tell. A turn the
// transcriber heard a tone in is ranked and answered with the tone's note on its text,
// `withTone`'s, and the ring holds the turn without it.
//
// Each turn takes one direction and never none. Every failure of the screen, of Jev or of the model
// hands the turn off, so the main model's session is the floor and nothing here
// throws to its caller or drops a turn in silence. A speech the speaker fails is not a hand-off:
// the bridge posted the line to the thread before the speech was asked for, and with the mirror
// off the speaker's own fallback posts the unspoken words there instead. A turn withdrawn by
// another turn's long cut-in (`cutIn`) is the one exception to the rule: its work
// is discarded, it is neither answered nor handed off, and a hand-off already delivered for it
// stands. Two turns the bridge reads as a stop phrase skip the ranking: one that stopped a reading
// joins the ring and goes no further (`stopHeard`), and one said while the session is working is
// handed off unranked (`handOffUnranked`).
//
// Three absences each narrow what the tier does, and none stops it. With no judge key, no turn is
// ranked and every turn hands off. With no fast key, or with no speaker, every turn hands off too,
// and none is ranked, since an answer that cannot be spoken belongs to the session's thread reply
// and the ranking would decide nothing; with no speaker there is no hand-off line either.
//
// What leaves the machine from here is the ring and the turn, screened for secrets before the Jev
// call and again before the model call; a hit makes neither call, and the turn never enters the
// ring, so it reaches no later call. Nothing logged carries the key, the turn, a line of the ring,
// a reply or a response body: a failure is logged by its kind or status alone, and a turn by its
// number.
import { SECRET_SCREEN, createJevClient } from "../jev/client.ts";
import type { JevFetch, JevResult } from "../jev/client.ts";
import { TONE_LABEL_SHAPE } from "./inworld.ts";
import type { Player } from "./player.ts";
import { HAND_OFF_LINES, MAIN_MODEL_PREFIX, systemPrompt } from "./prompt.ts";
import { RANK_QUESTIONS, RANK_REPEAT_LOG, decide, rankState } from "./rank.ts";
import type { LineNames, RankQuestion, RankThresholds } from "./rank.ts";
import { replyKind } from "./reply-check.ts";
import type { SpokenLine } from "./speaker.ts";
import type { TurnEvent } from "./transcriber.ts";

/** The one host an answer is ever asked of. A constant, so no argument or setting can redirect it. */
export const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/**
 * The turn's text as the fast tier ranks and answers it and the bridge hands it off: with
 * ` (sounded <label>)` after it where the transcriber heard a tone that fits `TONE_LABEL_SHAPE`,
 * and as it is otherwise, so a turn with no tone never carries an invented one. The label is the
 * speech vendor's text, so one off that shape, an uppercase or a spaced label among others, gets
 * no note, as no tone does, and no vendor text but a plain label reaches the model or the session.
 * The system prompt tells the model how to read the note. The ring never holds it, since a
 * remembered note would be sent to the vendors again as history.
 */
export function withTone(text: string, tone: string | undefined): string {
  return tone !== undefined && TONE_LABEL_SHAPE.test(tone) ? `${text} (sounded ${tone})` : text;
}

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

/** One message of the model's conversation: the ring's lines folded by speaker. */
export type AnthropicMessage = { role: "user" | "assistant"; content: string };

/** Who is appending a line: the operator's turn, the helper's answer, or the session's reply. */
export type RingWriter = "turn" | "answer" | "session reply";

/**
 * The kind a spoken line of the voice's is remembered under once the operator has heard it through:
 * `answer` for the helper's own, and `session reply` for the main model's reply that was read.
 */
export type Remember = Extract<RingWriter, "answer" | "session reply">;

/**
 * The speaker the tier is handed: `Speaker` with a second argument naming whether, and as what, the
 * line is remembered once heard through. A line that names none, a hand-off line or the bridge's
 * cannot-reach line, is spoken and never remembered. The bridge's wrapper speaker reads it, since a
 * speak settles when the last frame reaches the player rather than when it has played, and only the
 * bridge sees the operator's next turn, which is when a line counts as heard.
 */
export type TierSpeaker = {
  speak: (text: string, remember?: Remember) => Promise<void>;
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
 * Jev or the model. The turn's own text still reaches the session on a hand-off, and a screened
 * answer is still spoken.
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
 * The ring plus the turn as the Messages API takes them. The operator's lines are `user` messages
 * and the helper's are `assistant` messages, consecutive lines of either joined by a line break. A
 * main model's reply is a `user` message of its own that opens with `MAIN_MODEL_PREFIX`, joined to
 * nothing, so the small model never reads the main model's words as its own and the prefix always
 * opens the message the prompt tells it to look for. The first message is a `user` one, so a
 * leading helper line is dropped.
 */
export function toMessages(lines: readonly SpokenLine[]): AnthropicMessage[] {
  const messages: AnthropicMessage[] = [];
  // The speaker of the newest message, which decides whether the next line joins it.
  let newest: SpokenLine["role"] | null = null;
  for (const line of lines) {
    const last = messages[messages.length - 1];
    if (line.role === "persona") {
      messages.push({ role: "user", content: `${MAIN_MODEL_PREFIX} ${line.text}` });
    } else if (last !== undefined && newest === line.role) {
      last.content = `${last.content}\n${line.text}`;
    } else if (line.role === "user") {
      messages.push({ role: "user", content: line.text });
    } else if (last !== undefined) {
      messages.push({ role: "assistant", content: line.text });
    } else {
      continue;
    }
    newest = line.role;
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
   * Told the turn's text and its tone, where the transcriber heard one, once per hand-off, at the
   * hand-off, before any hand-off line is queued. The text is the ring's line, without the tone's
   * note. The bridge delivers it to the session with the note and the ring's lines past the mark,
   * and moves the mark. Returns whether the session was handed the turn: false where it was not,
   * and the bridge has then spoken its cannot-reach line.
   */
  handOff: (turn: string, tone?: string) => boolean;
  /**
   * How long the wait has been open, in milliseconds, or null while it is closed. The wait is the
   * bridge's: open from a hand-off delivered to the main model's session until that session's turn
   * ends. Read at each model call, for the sentence of state the system prompt carries.
   */
  waitMs: () => number | null;
  /**
   * `CHANNEL_VOICE_HOLD_FIRST_MS`: how long after a hand-off that is news the hand-off line waits
   * for the session's reply before it is spoken. Zero speaks it at the hand-off.
   */
  holdFirstMs: number;
  /**
   * Told the text of an answer whose turn was withdrawn while its speech was in flight, so the
   * bridge forgets it: the question has left the ring, and the answer must not be remembered alone.
   */
  forget?: (text: string) => void;
  log: (message: string) => void;
  /** The clock each turn is timed on. Injected so a test reads a figure without waiting. */
  now?: () => number;
  /** The hold's timer. Injected so a test drives its moment without waiting. */
  setTimer?: (callback: () => void, ms: number) => NodeJS.Timeout;
  clearTimer?: (timer: NodeJS.Timeout) => void;
};

export type FastTier = {
  /**
   * Takes one turn event. An `end` with words is ranked, an `end` with none, a lost one included,
   * is nothing, and the rest are ignored.
   */
  take: (event: TurnEvent) => void;
  /**
   * Speaks for the bridge, the session's answer among other things, through the same speaker and
   * in queue order with the tier's own speech, so no frame of it is ever timed as a turn's. Section
   * 5 speaks through this and nothing else. `remember` passes through to the speaker as the tier's
   * own answers pass `answer`. Resolves as the speaker does, at once with no speaker. Any speech
   * asked for here clears the hold: the bridge speaks the session's reply, the stopped line and the
   * cannot-reach line alone, and after any of them no hand-off line is owed. It leaves the tier's
   * reading of whether the last turn was handed off as it is.
   */
  speak: (text: string, remember?: Remember) => Promise<void>;
  /**
   * Appends a line of the voice's that the operator has heard through and returns whether it was
   * remembered: the main model's reply by default, as a `persona` line, or the helper's own under
   * `answer`, as a `helper` line. One that matches the secret screen is refused by the ring and
   * logged by a fixed line; it was still spoken, so the ring and what was said differ by that line,
   * by design, to keep a secret off the vendors the ring is sent to. The bridge calls this at the
   * operator's next turn's end, so a line a cut-in stopped short never arrives here.
   */
  said: (text: string, writer?: Remember) => boolean;
  /**
   * A long cut-in by turn `turn`: drops the work in flight for every other turn, so a model call
   * is aborted and a pending ranking is discarded on arrival, while the cutting-in turn itself is
   * left to be ranked and answered whether its end was taken before this call or after it. A
   * hand-off already delivered stands, and its hold is cleared unless it is the cutting-in turn's.
   * A hold cleared here never spoke its line, so the operator has not heard of that hand-off, and
   * the next hand-off is news.
   */
  cutIn: (turn: number) => void;
  /**
   * Operator turn `turn`, which answers an ASK and which the bridge hands off itself, unranked: its
   * line joins the ring, unless the ring refuses it as screened. Called before the bridge's hand-off,
   * so the event carries the line and the mark moves past it. No hand-off line is spoken for it.
   */
  answeredAsk: (turn: number, text: string) => void;
  /**
   * The outcome of the bridge's hand-off of operator turn `turn`, the answer to an ASK, told after
   * that hand-off returns. Delivered, it counts as a turn handed off, so the tier's next hand-off is
   * not news. Undelivered, the bridge spoke its cannot-reach line, a helper's line, so the next
   * hand-off is news.
   */
  askHandedOff: (turn: number, delivered: boolean) => void;
  /**
   * Operator turn `turn`, a stop phrase that stopped a reading: its line joins the ring, unless the
   * ring refuses it as screened, and the turn is neither ranked nor handed off. It leaves the
   * tier's reading of whether the last turn was handed off as it is.
   */
  stopHeard: (turn: number, text: string) => void;
  /**
   * Operator turn `turn`, a stop phrase said while the session is working and nothing is being
   * read: into the ring and handed off by the tier's own hand-off with no ranking call, since only
   * the session can stop its own work. Once the session has it, it always takes a hand-off line,
   * queued at once at any `holdFirstMs`, so the operator hears that his words were passed on.
   */
  handOffUnranked: (turn: number, text: string, tone: string | undefined) => void;
  /**
   * Clears the hold without speaking: the session's reply has arrived and the bridge holds it
   * behind the operator's floor, so no hand-off line is owed for it.
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
 * One finished turn and its work: its tone, the user line it put in the ring, the conversation it
 * is answered over (the ring before it plus the turn's text with its tone's note), when it ended,
 * the controller that aborts its model call, and the flags that keep a cancelled turn from being
 * answered or handed off, a hand-off line from being spoken twice for one turn, and a
 * withdrawn turn's line from being pulled from under an answer already spoken to it. `speaking` is
 * the answer's text while its speech is in flight, so a withdrawal then can name it to the bridge.
 */
type Turn = {
  number: number;
  text: string;
  tone: string | undefined;
  line: SpokenLine;
  history: readonly SpokenLine[];
  endedAt: number;
  controller: AbortController;
  cancelled: boolean;
  lineSpoken: boolean;
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
 * One model call over the conversation, under the system prompt for `session` with the state
 * sentence `waitMs` selects. Settles on every path: the reply text, or the failure kind, which is
 * `cancelled` where the turn's own controller aborted it.
 */
async function askModel(
  fast: FastModel,
  session: string,
  waitMs: number | null,
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
        system: systemPrompt(session, waitMs),
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
  // A pending hand-off line never keeps the broker's process alive at shutdown.
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref());
  const clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer));
  /** The next hand-off line of the rotation, which starts at the first for each joined channel. */
  let nextLine = 0;
  /**
   * Whether the last turn the helper answered or that was given to the main model was given to the
   * main model, which is what makes the next hand-off news or not. No at a join. A delivered
   * hand-off sets it to yes, the tier's own and the bridge's own for the answer to a spoken
   * question alike, and one that reached no session sets it to no, since the operator last heard
   * the cannot-reach line. A helper's answer sets it to no where its turn is newer than
   * `handedOffTurn`, so a late answer to an earlier turn never makes the next hand-off news. A cut-in
   * that clears a hold before its line sets it to no, and so does a stop over a reading, which the
   * bridge passes on as a cut-in. The stopped line and a stray turn never reach it.
   */
  let handedOff = false;
  /** The turn of the delivered hand-off that last set `handedOff` to yes. */
  let handedOffTurn = 0;
  /**
   * The hold: a hand-off line waiting on its timer and the handed-off turn it is spoken for, or
   * null. One at a time, so one wait never hears two lines.
   */
  let hold: { turn: Turn; timer: NodeJS.Timeout } | null = null;
  /** Counts ranking submissions, so no two ever share a key at the Jev client. */
  let submissions = 0;

  const player: Pick<Player, "play"> = {
    play(pcm) {
      // The first frame of the speech at the head charges it; the rest of that speech charge nothing.
      const head = awaiting[0];
      if (head !== undefined && !head.charged) {
        head.charged = true;
        if (head.turn !== null && head.outcome !== null) {
          const what = head.outcome === "answered" ? "first audio" : "hand-off line";
          log(`voice: turn ${head.outcome}, ${what} after ${String(Math.round(now() - head.turn.endedAt))}ms`);
        }
      }
      options.player.play(pcm);
    },
  };

  /**
   * Speaks through the speaker in queue order. A turn's speech is timed by its first frame; one
   * that settles with no frame, as one the speaker failed does, is logged as such. The bridge's
   * speech, with no turn, holds its place and is never charged.
   */
  function speak(
    voice: TierSpeaker,
    turn: Turn | null,
    outcome: Outcome | null,
    text: string,
    remember?: Remember,
  ): Promise<void> {
    const entry: Awaiting = { turn, outcome, charged: false };
    awaiting.push(entry);
    return voice.speak(text, remember).then(() => {
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
    clearTimer(hold.timer);
    hold = null;
  }

  /**
   * Speaks the next hand-off line of the rotation for the turn, once per turn. A turn withdrawn
   * since its hand-off gets none.
   */
  function handOffLine(voice: TierSpeaker, turn: Turn): void {
    if (turn.cancelled || turn.lineSpoken) return;
    turn.lineSpoken = true;
    const line = HAND_OFF_LINES[nextLine];
    nextLine = (nextLine + 1) % HAND_OFF_LINES.length;
    void speak(voice, turn, "handed off", line);
  }

  /**
   * Hands the turn off: the callback, then the hand-off line where it is owed. A line is owed where
   * the callback delivered the turn and the hand-off is news, the last turn answered or handed off
   * having been answered, and always with `atOnce`, the unranked hand-off of a stop phrase. It is
   * queued here, as the callback returns, where `holdFirstMs` is zero or with `atOnce`, so a stop
   * phrase's line is heard ahead of a reply the bridge speaks once this returns; otherwise the hold
   * is armed for it, in place of any earlier one. A hand-off that is not news speaks nothing, and a
   * line still waiting from the hand-off before it stays timed from that one and becomes this
   * turn's, so one wait hears one line. A hand-off the callback did not deliver speaks no line and
   * arms no hold: the bridge has spoken its cannot-reach line. A cancelled turn is neither held nor
   * handed off. A throw out of the callback is the bridge's defect, logged by turn number, ended
   * here so it reaches neither the Jev client's handler nor the answer chain, and read as a turn
   * not delivered.
   */
  function handOff(turn: Turn, atOnce = false): void {
    if (turn.cancelled) return;
    turn.done = true;
    const news = !handedOff || atOnce;
    let delivered = false;
    try {
      delivered = options.handOff(turn.text, turn.tone);
    } catch {
      log(`voice: the hand-off callback threw turn=${String(turn.number)}`);
    }
    if (!delivered) {
      handedOff = false;
      return;
    }
    handedOff = true;
    handedOffTurn = turn.number;
    if (speaker === null) {
      // With nothing to speak through, the log line stands in for the hand-off line, once per turn.
      if (!turn.lineSpoken) {
        turn.lineSpoken = true;
        log("voice: turn handed off, no speaker for the hand-off line");
      }
    } else if (!news) {
      if (hold !== null) hold.turn = turn;
    } else {
      const voice = speaker;
      clearHold();
      if (options.holdFirstMs === 0 || atOnce) {
        handOffLine(voice, turn);
      } else if (!turn.lineSpoken) {
        const armed = {
          turn,
          timer: setTimer(() => {
            // The hold's one line: once it is spoken, nothing is left to clear.
            if (hold === armed) hold = null;
            handOffLine(voice, armed.turn);
          }, options.holdFirstMs),
        };
        hold = armed;
      }
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
    const result = await askModel(fast, names().session, options.waitMs(), turn.history, turn.controller.signal);
    if (turn.cancelled) return;
    if (!result.ok) {
      log(`voice: the helper's answer failed (${result.kind}), so the turn is handed off`);
      handOff(turn);
      return;
    }
    // A reply that is the hand-off token, or that speaks about its own reach or takes back an earlier
    // line, is discarded unspoken and unremembered, and the turn goes to the session. The log names
    // the kind alone, never the reply.
    const held = replyKind(result.text);
    if (held !== null) {
      log(`voice: the helper's answer was held back (${held}), so the turn is handed off`);
      handOff(turn);
      return;
    }
    // Handed over to be remembered as an answer once heard through: the speaker's wrapper holds it
    // until the operator's next turn ends, and a cut-in before then drops it, so an answer the
    // player had queued and never played is not the helper's words. The helper answered this turn,
    // so where it is newer than the last turn handed off, the next hand-off is news. A line still
    // waiting for an earlier turn would play after this answer and sound as if this turn was handed
    // off, so it is cleared.
    if (turn.number > handedOffTurn) handedOff = false;
    if (hold !== null && hold.turn.number < turn.number) clearHold();
    turn.speaking = result.text;
    await speak(speaker, turn, "answered", result.text, "answer");
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

  /**
   * A finished turn: into the ring, through the screen, and to the judge. The ring takes the text
   * alone, and the ranking and the answer take it with the tone's note. With `ranked` false the
   * turn is handed off with no ranking call, and its hand-off line is spoken at once.
   */
  function ended(number: number, text: string, tone: string | undefined, ranked = true): void {
    const endedAt = now();
    // A record for the same turn is an earlier end this one replaces: its work still open is
    // withdrawn, its line leaves the ring unless an answer was
    // spoken to it, and a hand-off line already spoken for it is not spoken again. Settled
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
    // The ring refuses a screened turn, so its hand-off line is spoken over the ring as it stood
    // and the next turn is ranked over a ring that holds nothing of it. The call decision screens
    // the turn and the ring together, which agree, since the ring holds no screened line.
    const held = ring.append(line, "turn");
    const hit = !held || screened(before.map((earlier) => earlier.text));
    const noted = withTone(text, tone);
    const turn: Turn = {
      number,
      text,
      tone,
      line,
      history: held ? [...before, { role: "user", text: noted }] : before,
      endedAt,
      controller: new AbortController(),
      cancelled: false,
      lineSpoken: prior?.lineSpoken ?? false,
      answered: false,
      done: false,
      speaking: null,
    };
    open.set(number, turn);
    if (hit) {
      log(`voice: a turn matched the secret screen, so it is handed off with no call made turn=${String(number)}`);
      handOff(turn, !ranked);
      return;
    }
    // With no judge nothing can rank the turn. With no model or no speaker a turn ranked as
    // answerable hands off all the same, so the ranking would decide nothing and is not asked for.
    if (!ranked || judge === null || fast === null || speaker === null) {
      handOff(turn, !ranked);
      return;
    }
    // A key of its own per submission: the Jev client parks a second submission on one key behind
    // the first call, which would hold a turn's later end behind its withdrawn one.
    submissions += 1;
    judge.submit(`${String(number)}/${String(submissions)}`, rankState(before, noted, names()), turn);
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
        // A lost end has no final text, and an empty end carries none: neither is a turn, so
        // neither is ranked, remembered or held.
        if (event.lost === true || event.text.trim() === "") return;
        ended(event.turn, event.text, event.tone);
      }
    },
    speak(text, remember) {
      clearHold();
      if (speaker === null) return Promise.resolve();
      return speak(speaker, null, null, text, remember);
    },
    said(text, writer = "session reply") {
      return ring.append({ role: writer === "answer" ? "helper" : "persona", text }, writer);
    },
    answeredAsk(_number, text) {
      ring.append({ role: "user", text }, "turn");
    },
    askHandedOff(number, delivered) {
      handedOff = delivered;
      if (delivered) handedOffTurn = number;
    },
    stopHeard(_number, text) {
      ring.append({ role: "user", text }, "turn");
    },
    handOffUnranked(number, text, tone) {
      ended(number, text, tone, false);
    },
    cutIn(number) {
      // The cutting-in turn's own record is spared, whether its end was taken before this call or
      // arrives after it, so a long question is answered rather than withdrawn by its own cut-in.
      for (const turn of open.values()) {
        if (turn.number !== number && !turn.done) withdraw(turn);
      }
      if (hold !== null && hold.turn.number !== number) {
        // The hold's line was never spoken, so the operator has not heard of that hand-off.
        if (!hold.turn.lineSpoken) handedOff = false;
        clearHold();
      }
    },
    clearHold,
    leave() {
      clearHold();
      for (const turn of open.values()) withdraw(turn);
      open.clear();
      awaiting.length = 0;
      ring.clear();
    },
    ring: { lines: ring.lines, sinceMark: ring.sinceMark, markNewest: ring.markNewest },
    player,
  };
}
