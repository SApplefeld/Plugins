// The one copy of the checks an act on an open ask passes, and of the hold that keeps one version of
// an item to one delivered line. An act is an Agree, an Answer, which the page's code calls Correct, or
// an ask's Dismiss. A caller finds the open ask in its own reading of the ledger and passes what
// differs between callers: the fields it drew, how the line is delivered, how it is worded, which act
// the handled mark records and what the log lines open with.
//
// `createAskActs` makes the acted set, so a broker process calls it once and every caller it hands
// the result to shares the set: an item version one caller is delivering a line for, or delivered one
// for, is `already-acted` to every other. This file imports nothing from `./server.ts` or
// `../door.ts`, so either can import it.
import { MAX_ASK_FIELD_LENGTH, questionOf } from "../decisions/ledger.ts";
import type { AskEntry } from "../decisions/ledger.ts";
import type { Logger } from "../log.ts";
import { fit, oneLine } from "../sanitize.ts";
import { drawnAsk } from "./views.ts";
import { handledHides, handledKey } from "./watermarks.ts";
import type { HandledHow, HandledMark, WatermarkStore } from "./watermarks.ts";

/** An ask id is the ledger's own string, cut there to this many code points; a longer one names no ask. */
export const MAX_ASK_ID_LENGTH = MAX_ASK_FIELD_LENGTH;

/** A question or a block's reason quoted in a line is cut to this many code points, so the line stays short. */
const MAX_QUOTED_LENGTH = 200;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * A question, a reason or an item's id as a line quotes it: one line, cut with `fit` to
 * `MAX_QUOTED_LENGTH`, so a cut ends in its ellipsis. Every text a worker wrote rides quoted this way,
 * the ids included, so none can read as the operator's own words around it.
 */
export function quoted(text: string): string {
  return fit(oneLine(text), MAX_QUOTED_LENGTH);
}

/** The decision time in the broker host's local time, `YYYY-MM-DD HH:mm`, zero padded. */
export function decidedAt(at: number): string {
  const when = new Date(at);
  return `${String(when.getFullYear())}-${pad2(when.getMonth() + 1)}-${pad2(when.getDate())} ${pad2(when.getHours())}:${pad2(when.getMinutes())}`;
}

/**
 * The most code points of words an answer through the local door carries. The answer line's fixed
 * words, its id and its question, each quoted and cut to `MAX_QUOTED_LENGTH`, come to at most 422
 * code points, so a line with this many words stays under the inbound router's 4,000 and is
 * never cut: a cut line would put unfinished words into a session.
 */
export const MAX_DOOR_ANSWER_WORDS_LENGTH = 3_500;

/**
 * The line an agreement through the local door sends: the page's Agree line, the ask's id quoted
 * and cut, the recommendation as the ledger holds it on one line and the decision time, ending in
 * the portal where the page's line names the page.
 */
export function doorAgreeLine(askId: string, recommend: string, at: number): string {
  return `Agree: proceed on your recommendation on ask "${quoted(askId)}", "${oneLine(recommend)}". Decided ${decidedAt(at)} from the portal.`;
}

/**
 * The line an answer in words through the local door sends: the ask's id and its question as the
 * pages draw it, each quoted and cut, then the words as they were sent. No decision time follows,
 * since text after the words would read as theirs.
 */
export function doorAnswerLine(askId: string, question: string, words: string): string {
  return `Answer on ask "${quoted(askId)}", "${quoted(questionOf(question))}": ${words}`;
}

/**
 * An ask's key in the acted set: its lineage and id with the times it was opened and last raised
 * again, so an ask its session raises again is a new version that can be acted on. The handled
 * mark's own key, `handledKey`, stays the id alone.
 */
export function askActedKey(repo: string, entry: AskEntry): string {
  return JSON.stringify([repo, entry.id, entry.openedAt, entry.reraisedAt]);
}

/** The three fields of an ask as a caller drew them, as `drawnAsk` draws them from the entry. */
export type DrawnAsk = ReturnType<typeof drawnAsk>;

/** A time as a caller sends one: the ISO string the view gave it, or null where the view gave none. */
const isDrawnTime = (value: unknown): value is string | null => value === null || typeof value === "string";

/**
 * The question and the two times a body says its sender drew, or null where the body carries no
 * `question` string, or an `openedAt` or `reraisedAt` that is neither a string nor null. A missing or
 * mistyped field is not a malformed body: it is an act on text the broker cannot match, which every
 * ask act answers as `changed`, as an Agree with no recommendation is.
 */
export function drawnOf(value: Record<string, unknown>): DrawnAsk | null {
  const { question, openedAt, reraisedAt } = value;
  if (typeof question !== "string" || !isDrawnTime(openedAt) || !isDrawnTime(reraisedAt)) return null;
  return { question, openedAt, reraisedAt };
}

/**
 * Whether the body's three fields are the entry's as the views draw them, byte for byte, a null time
 * equal only to a null; false where the body carries none. An act is an act on the ask its sender
 * read, so a question rewritten or an ask raised again since it was drawn is not that ask.
 */
export function drawnMatches(drawn: DrawnAsk | null, entry: AskEntry): boolean {
  if (drawn === null) return false;
  const held = drawnAsk(entry);
  return drawn.question === held.question && drawn.openedAt === held.openedAt && drawn.reraisedAt === held.reraisedAt;
}

/** The recommendation an Answer or an ask's Dismiss says its sender drew, null kept as null. */
export type DrawnRecommend = { recommend: string | null };

/**
 * The recommendation a body says its sender drew, or null where the body carries no `recommend` that
 * is a string or null. A missing or mistyped one is not a malformed body: it is an act on text the
 * broker cannot match, which Answer and an ask's Dismiss answer as `changed`.
 */
export function drawnRecommendOf(value: Record<string, unknown>): DrawnRecommend | null {
  const { recommend } = value;
  return recommend === null || typeof recommend === "string" ? { recommend } : null;
}

/**
 * Whether the body's recommendation is the entry's, byte for byte, a null equal only to a null; false
 * where the body carries none. The question a caller sends is cut before the recommendation, so this
 * is what holds an Answer or a Dismiss to the recommendation its sender read.
 */
export function recommendMatches(drawn: DrawnRecommend | null, entry: AskEntry): boolean {
  return drawn !== null && drawn.recommend === entry.recommend;
}

/**
 * Why an ask act handed no line: `closed` where the caller found no open ask, `refused: blocking` a
 * blocking ask in a batch, `already-acted` a version that took a line or is taking one,
 * `no-recommendation` an ask with nothing to agree to, and `changed` an ask whose question, version
 * or recommendation is no longer the text the sender drew.
 */
export type AskRefusal = "closed" | "refused: blocking" | "already-acted" | "no-recommendation" | "changed";

/** One line to deliver under an acted key, with the handled mark a delivered line writes. */
export type ActRequest<S extends string> = {
  /** The item version's key in the acted set, `askActedKey` for an ask. */
  key: string;
  /** What the log line for a mark that was not written opens with. */
  label: string;
  /** Hands the line to the item's session and answers the router's word for it. */
  deliver: (line: string) => Promise<S>;
  /** The line, composed at the decision time. */
  line: (at: number) => string;
  /** The item's handled mark, stamped with the same decision time. */
  mark: (at: number) => HandledMark;
};

type AskActShared<S extends string> = {
  /** The persona's roster name, the lineage its session carries and its marks are held under. */
  repo: string;
  /** The open ask the caller found in its own reading, or none, which answers `closed`. */
  entry: AskEntry | null | undefined;
  /** The question and the two times the sender drew, or null where its body carried none. */
  drawn: DrawnAsk | null;
  /** Hands the line to the persona's session and answers the router's word for it. */
  deliver: (line: string) => Promise<S>;
  /** Which act the handled mark of a delivered line records. */
  how: HandledHow;
  /** What every log line of the act opens with, composed from the entry the caller found. */
  label: (entry: AskEntry) => string;
};

/**
 * An act on an ask. An Agree carries the recommendation its sender drew as a string, null where it
 * sent none, and whether it is one item of a batch, which refuses a blocking ask. An Answer or a
 * Dismiss carries the recommendation through `drawnRecommendOf`, so a null is equal only to a null.
 */
export type AskActRequest<S extends string> = AskActShared<S> &
  (
    | {
        act: "agree";
        recommend: string | null;
        inBatch: boolean;
        /** The line, from the entry, its recommendation and the decision time. */
        line: (entry: AskEntry, recommended: string, at: number) => string;
      }
    | {
        act: "answer" | "dismiss";
        recommend: DrawnRecommend | null;
        /** The line, from the entry and the decision time. */
        line: (entry: AskEntry, at: number) => string;
      }
  );

export type AskActsOptions = {
  /** The one store of handled marks: read to refuse a version a mark hides, written after a delivered line. */
  marks: Pick<WatermarkStore, "marks" | "markHandled">;
  /** The decision time's clock. Injected so a test fixes it. */
  now?: () => number;
  log?: Logger;
};

export type AskActs = {
  /**
   * Runs an ask act's checks in order and, where none refuses, delivers its line through `act`. The
   * first that holds answers. For an Agree: `closed`, `refused: blocking` in a batch, `already-acted`,
   * `no-recommendation`, `changed`. For an Answer and a Dismiss: `closed`, `already-acted`, `changed`.
   * `already-acted` holds where the acted set holds the version's key, and where a handled mark hides
   * the version by `handledHides`, which a broker restart does not forget. The checks run before
   * anything is awaited, so two acts on one version never both pass them. Every status but a `closed`
   * is logged as `<label>: <status>`.
   */
  askAct: <S extends string>(request: AskActRequest<S>) => Promise<S | AskRefusal>;
  /**
   * Hands an item's line to its session under the item's acted key. The key is held before the
   * delivery is awaited, so a second act on the item that arrives while the first is out finds it
   * held; any answer but `delivered` gives the key back, and so does a delivery that throws, whose
   * error reaches the caller. A delivered line writes the item's handled mark, stamped with the
   * line's own decision time, after the delivery and never before. A mark that cannot be written
   * leaves the answer `delivered`, is logged once, and gives the key back, since the item is still
   * drawn.
   */
  act: <S extends string>(request: ActRequest<S>) => Promise<S>;
  /** Whether the acted set holds a key: a line for that item version was delivered, or is out now. */
  holds: (key: string) => boolean;
};

/** Makes the acted set and the acts over it. Called once for a broker process, so the set is one. */
export function createAskActs(options: AskActsOptions): AskActs {
  const now = options.now ?? Date.now;
  const { marks, log } = options;
  /** The item versions this broker process delivered a line for, or is delivering one for now. */
  const acted = new Set<string>();

  async function act<S extends string>({ key, label, deliver, line, mark }: ActRequest<S>): Promise<S> {
    acted.add(key);
    const at = now();
    let delivered = false;
    let status: S;
    try {
      status = await deliver(line(at));
      delivered = status === "delivered";
    } finally {
      if (!delivered) acted.delete(key);
    }
    if (delivered) {
      try {
        marks.markHandled(mark(at));
      } catch {
        acted.delete(key);
        log?.warn(`${label}: the handled mark was not written`);
      }
    }
    return status;
  }

  /** An ask's handled mark from the entry its line was composed from. */
  const askMark = (repo: string, entry: AskEntry, how: HandledHow) => (at: number): HandledMark => ({
    kind: "ask",
    repo,
    askId: entry.id,
    openedAt: entry.openedAt,
    seenRaise: entry.reraisedAt,
    markedAt: at,
    how,
  });

  async function askAct<S extends string>(request: AskActRequest<S>): Promise<S | AskRefusal> {
    const { repo, entry } = request;
    if (entry === undefined || entry === null) return "closed";
    const label = request.label(entry);
    const settle = <T extends string>(status: T): T => {
      log?.info(`${label}: ${status}`);
      return status;
    };
    if (request.act === "agree" && request.inBatch && entry.blocking === true) return settle("refused: blocking");
    const key = askActedKey(repo, entry);
    // The set is this process's memory and the mark is the file's, so a version that took a line
    // before a restart is refused as one that took it since.
    if (acted.has(key) || handledHides(marks.marks().handled.get(handledKey(repo, entry.id)), entry)) return settle("already-acted");
    let line: (at: number) => string;
    if (request.act === "agree") {
      const recommended = entry.recommend;
      if (recommended === null || recommended.trim() === "") return settle("no-recommendation");
      // Byte for byte: a recommendation rewritten since the sender drew it is not what was agreed
      // to, and the line it would compose was never read. The question and the version drawn are
      // held to the same rule, since a question can change under a recommendation that does not.
      if (request.recommend !== recommended || !drawnMatches(request.drawn, entry)) return settle("changed");
      const compose = request.line;
      line = (at) => compose(entry, recommended, at);
    } else {
      // An Answer or a Dismiss is for the ask its sender read: any other question, version or recommendation delivers nothing.
      if (!drawnMatches(request.drawn, entry) || !recommendMatches(request.recommend, entry)) return settle("changed");
      const compose = request.line;
      line = (at) => compose(entry, at);
    }
    return settle(await act({ key, label, deliver: request.deliver, line, mark: askMark(repo, entry, request.how) }));
  }

  return { askAct, act, holds: (key) => acted.has(key) };
}
