// The web surface's three marks: two the operator sets, a per-repo "caught up" time and a per-plan
// "seen" snapshot of the plan's status and chapter count, and a per-item "handled" mark the act
// routes write when an Agree, Correct or Dismiss line from the pages was delivered to the item's
// session, or when a review was dismissed from the page, which delivers nothing. A handled mark
// hides an open ask until the persona closes it or raises it again, a blocked queue entry while
// it still reads blocked for the same reason, and a review while a queue entry under the repo
// carries its pull request number. They live in one file, `web-watermarks.json`, in the
// directory of the broker's state file, written whole through `writeSnapshot`, the same
// temp-and-rename the registry snapshot uses, so a crash mid-write leaves the previous file intact.
//
// The store holds the marks in memory and the file is read once, when the store opens. A write is made
// to a copy and committed to memory only after the file write succeeded, so memory never runs ahead of
// the disk: a failed write throws and leaves both as they were.
//
// A file that is missing, unreadable, of no version this store reads, or not JSON opens as an empty
// store. A missing file is the first run and says nothing. Any other cause is logged once, by fixed
// sentence, and the next write replaces the file; what the file held is not recovered. An entry inside
// a readable file that does not validate is dropped alone and the rest stand. A version 1 file, written
// before the handled list, holds a `done` list instead: each of its marks hid an ask with no line sent,
// and it reads as a handled ask mark whose `how` is `dismissed`. Every write is the current version.
import { readFileSync } from "node:fs";
import path from "node:path";
import { writeSnapshot } from "../persistence.ts";
import type { LedgerReading } from "../decisions/ledger.ts";
import { MAX_ASKS_PER_LIST } from "../decisions/ledger.ts";
import { foldRootName } from "./config.ts";

/** The file's name, beside `broker-state.json`. */
export const WATERMARKS_FILE_NAME = "web-watermarks.json";

const FORMAT_VERSION = 2;

/** The version written before the handled list existed, whose `done` list this store still reads. */
const DONE_LIST_VERSION = 1;

/** What the operator saw of one plan: when, and the two values a later look is compared against. */
export type PlanMark = { root: string; path: string; seenAt: number; status: string; chapters: number };

/** Which act's delivered line set a handled mark. */
export type HandledHow = "agreed" | "corrected" | "dismissed";

const HOWS: ReadonlySet<string> = new Set<HandledHow>(["agreed", "corrected", "dismissed"]);

/**
 * An open ask whose line was delivered: its persona's roster name, its ledger id, the `openedAt` it
 * carried when marked (null where the ledger gave none), the `reraisedAt` of the reading the line was
 * composed from (null where the ask had never been raised again), when the line was delivered, which
 * is for display, and which act sent it.
 */
export type AskHandledMark = {
  kind: "ask";
  repo: string;
  askId: string;
  openedAt: number | null;
  seenRaise: number | null;
  markedAt: number;
  how: HandledHow;
};

/**
 * A blocked queue entry whose Dismiss line was delivered: its persona's roster name, the entry's id,
 * the block's text as the blocked item drew it, the fallback sentence included, when the line was
 * delivered, and which act sent it.
 */
export type BlockedHandledMark = { kind: "blocked"; repo: string; entryId: string; reason: string; markedAt: number; how: HandledHow };

/**
 * A review the operator dismissed from the page: its persona's roster name and the pull request's
 * number, when it was dismissed, and `dismissed`, since no line is sent for a review.
 */
export type ReviewHandledMark = { kind: "review"; repo: string; pullRequest: number; markedAt: number; how: HandledHow };

export type HandledMark = AskHandledMark | BlockedHandledMark | ReviewHandledMark;

/** The marks a view reads: caught-up times by roster name, seen snapshots by `planMarkKey`, and handled marks by `handledKey`, `blockedHandledKey` or `reviewHandledKey`. */
export type Marks = {
  repos: ReadonlyMap<string, number>;
  plans: ReadonlyMap<string, PlanMark>;
  handled: ReadonlyMap<string, HandledMark>;
};

export const EMPTY_MARKS: Marks = { repos: new Map(), plans: new Map(), handled: new Map() };

/** The key an ask's handled mark is held under: the persona's name and the ask's id, since ids are the ledger's per persona. */
export function handledKey(repo: string, askId: string): string {
  return JSON.stringify([repo, askId]);
}

/** The key a blocked entry's handled mark is held under: three parts where an ask's key has two, so the two never collide. */
export function blockedHandledKey(repo: string, entryId: string): string {
  return JSON.stringify([repo, "blocked", entryId]);
}

/** The key a review's handled mark is held under: the persona's name and the pull request's number, so a number re-used by a later plan is a review of its own. */
export function reviewHandledKey(repo: string, pullRequest: number): string {
  return JSON.stringify([repo, "review", pullRequest]);
}

/** The key a handled mark is held under, by its kind. */
function keyOf(mark: HandledMark): string {
  if (mark.kind === "ask") return handledKey(mark.repo, mark.askId);
  if (mark.kind === "blocked") return blockedHandledKey(mark.repo, mark.entryId);
  return reviewHandledKey(mark.repo, mark.pullRequest);
}

/**
 * Whether a handled mark hides this open ask: the mark carries the ask's `openedAt`, which the ledger
 * keeps across a re-raise, and the ledger shows no re-raise the mark did not see. A re-raise is the
 * persona asking again, so the ask returns. No clock is compared, so the delivery's time decides nothing.
 */
export function handledHides(mark: HandledMark | undefined, ask: { openedAt: number | null; reraisedAt: number | null }): boolean {
  if (mark === undefined || mark.kind !== "ask" || mark.openedAt !== ask.openedAt) return false;
  if (ask.reraisedAt === null) return true;
  return mark.seenRaise !== null && ask.reraisedAt <= mark.seenRaise;
}

/** Whether a handled mark hides a blocked entry whose item draws `reason`: the block the line dismissed, by its text. */
export function blockedHides(mark: HandledMark | undefined, reason: string): boolean {
  return mark !== undefined && mark.kind === "blocked" && mark.reason === reason;
}

/**
 * The blocked queue entries a reading holds, by persona name and then entry id, each with the text its
 * blocked item draws. A persona whose queue the reading does not hold is absent; null where the queues
 * have never been read. Built by `blockedReasons` in `./views.ts`, the one reading of the blocked rule.
 */
export type BlockedReasons = ReadonlyMap<string, ReadonlyMap<string, string>> | null;

/**
 * The pull request numbers the queue entries of a reading carry, by persona name. A persona whose
 * queue the reading does not hold is absent; null where the queues have never been read. Built by
 * `withMarks` from the queues reading, one map per reading.
 */
export type ReviewNumbers = ReadonlyMap<string, ReadonlySet<number>> | null;

/** The slice of a queues reading `withMarks` reads the pull request numbers from. */
type QueuesWithNumbers = { value: readonly { queue: { name: string; entries: readonly { pullRequest?: number }[] } }[] | null };

const reviewMemo = new WeakMap<NonNullable<QueuesWithNumbers["value"]>, ReviewNumbers>();

/** The pull request numbers one queues reading carries, built once per reading so a prune on the same reading is the same object. */
function reviewNumbersOf(queues: QueuesWithNumbers): ReviewNumbers {
  const value = queues.value;
  if (value === null) return null;
  const held = reviewMemo.get(value);
  if (held !== undefined) return held;
  const byRepo = new Map<string, ReadonlySet<number>>();
  for (const { queue } of value) {
    byRepo.set(queue.name, new Set(queue.entries.flatMap((entry) => (entry.pullRequest === undefined ? [] : [entry.pullRequest]))));
  }
  reviewMemo.set(value, byRepo);
  return byRepo;
}

/** The key a plan's seen mark is held under: the root's folded name and the plan's relative path. */
export function planMarkKey(root: string, relativePath: string): string {
  return JSON.stringify([foldRootName(root), relativePath]);
}

export type WatermarkStore = {
  /** The marks as they stand now. Read-only, and replaced rather than changed by a write. */
  marks: () => Marks;
  /** Sets a repo's caught-up time. Throws if the file cannot be written, and then changes nothing. */
  caughtUp: (repo: string, at: number) => void;
  /** Sets a plan's seen mark. Throws if the file cannot be written, and then changes nothing. */
  seen: (root: string, relativePath: string, snapshot: { status: string; chapters: number }, at: number) => void;
  /** Sets an item's handled mark, replacing any earlier one. Throws if the file cannot be written, and then changes nothing. */
  markHandled: (mark: HandledMark) => void;
  /**
   * Drops each ask's handled mark whose ask the ledger reading shows closed, each blocked entry's
   * whose entry the queues reading shows no longer blocked, or blocked for another reason, and each
   * review's whose pull request number no queue entry under its persona carries in `reviews`. A
   * persona the reading does not cover, one off the roster among them, or whose ledger reading cannot
   * answer, keeps its marks: one with no ledger, no good file read, or an open list at the reader's
   * cap, since an ask missing there may still be open. Never throws: a write that fails is logged
   * once, is not retried on the same readings, and the marks stand.
   */
  pruneHandled: (ledger: readonly LedgerReading[] | null, blocked: BlockedReasons, reviews?: ReviewNumbers) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function timeOf(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}

/** The marks a file's text holds, or null where the text is not a file this store wrote. */
function parseMarks(text: string): Marks | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || (parsed.version !== FORMAT_VERSION && parsed.version !== DONE_LIST_VERSION)) return null;
  const repos = new Map<string, number>();
  const plans = new Map<string, PlanMark>();
  const handled = new Map<string, HandledMark>();
  for (const item of Array.isArray(parsed.repos) ? (parsed.repos as unknown[]) : []) {
    if (!isRecord(item) || typeof item.name !== "string") continue;
    const at = timeOf(item.caughtUpAt);
    if (at !== null) repos.set(item.name, at);
  }
  for (const item of Array.isArray(parsed.plans) ? (parsed.plans as unknown[]) : []) {
    if (!isRecord(item)) continue;
    const { root, path: planPath, status, chapters } = item;
    const at = timeOf(item.seenAt);
    if (typeof root !== "string" || typeof planPath !== "string" || typeof status !== "string") continue;
    if (typeof chapters !== "number" || !Number.isInteger(chapters) || chapters < 0 || at === null) continue;
    plans.set(planMarkKey(root, planPath), { root, path: planPath, seenAt: at, status, chapters });
  }
  // A version 1 file's `done` list, or none where it was written before that list existed, reads as
  // dismissed asks; a current file's `handled` list carries each mark's kind and act.
  const listed = parsed.version === DONE_LIST_VERSION ? parsed.done : parsed.handled;
  for (const item of Array.isArray(listed) ? (listed as unknown[]) : []) {
    const mark = parsed.version === DONE_LIST_VERSION ? askMarkOf(item, "dismissed") : handledMarkOf(item);
    if (mark !== null) handled.set(keyOf(mark), mark);
  }
  return { repos, plans, handled };
}

/** An ask's handled mark out of a file's entry, or null where the entry does not validate. */
function askMarkOf(item: unknown, how: HandledHow): AskHandledMark | null {
  if (!isRecord(item) || typeof item.repo !== "string" || typeof item.askId !== "string") return null;
  const markedAt = timeOf(item.markedAt);
  const openedAt = item.openedAt === null ? null : timeOf(item.openedAt);
  const seenRaise = item.seenRaise === null || item.seenRaise === undefined ? null : timeOf(item.seenRaise);
  if (markedAt === null || (item.openedAt !== null && openedAt === null)) return null;
  if (item.seenRaise !== null && item.seenRaise !== undefined && seenRaise === null) return null;
  return { kind: "ask", repo: item.repo, askId: item.askId, openedAt, seenRaise, markedAt, how };
}

/** A current file's handled mark of either kind, or null where the entry does not validate. */
function handledMarkOf(item: unknown): HandledMark | null {
  if (!isRecord(item) || typeof item.how !== "string" || !HOWS.has(item.how)) return null;
  const how = item.how as HandledHow;
  if (item.kind === "ask") return askMarkOf(item, how);
  const markedAt = timeOf(item.markedAt);
  if (typeof item.repo !== "string" || markedAt === null) return null;
  if (item.kind === "review") {
    const { pullRequest } = item;
    if (typeof pullRequest !== "number" || !Number.isInteger(pullRequest) || pullRequest <= 0) return null;
    return { kind: "review", repo: item.repo, pullRequest, markedAt, how };
  }
  if (item.kind !== "blocked") return null;
  const { entryId, reason } = item;
  if (typeof entryId !== "string" || typeof reason !== "string") return null;
  return { kind: "blocked", repo: item.repo, entryId, reason, markedAt, how };
}

/** A handled mark as the file holds it, its times as ISO strings. */
function savedMark(mark: HandledMark): Record<string, unknown> {
  const markedAt = new Date(mark.markedAt).toISOString();
  if (mark.kind === "blocked") {
    return { kind: mark.kind, repo: mark.repo, entryId: mark.entryId, reason: mark.reason, markedAt, how: mark.how };
  }
  if (mark.kind === "review") {
    return { kind: mark.kind, repo: mark.repo, pullRequest: mark.pullRequest, markedAt, how: mark.how };
  }
  return {
    kind: mark.kind,
    repo: mark.repo,
    askId: mark.askId,
    openedAt: mark.openedAt === null ? null : new Date(mark.openedAt).toISOString(),
    seenRaise: mark.seenRaise === null ? null : new Date(mark.seenRaise).toISOString(),
    markedAt,
    how: mark.how,
  };
}

function serialize(marks: Marks): string {
  return JSON.stringify(
    {
      version: FORMAT_VERSION,
      repos: [...marks.repos].map(([name, at]) => ({ name, caughtUpAt: new Date(at).toISOString() })),
      plans: [...marks.plans.values()].map((mark) => ({
        root: mark.root,
        path: mark.path,
        seenAt: new Date(mark.seenAt).toISOString(),
        status: mark.status,
        chapters: mark.chapters,
      })),
      handled: [...marks.handled.values()].map(savedMark),
    },
    null,
    2,
  );
}

/**
 * Whether a persona's reading could have listed an ask open and did not: it holds a ledger, read from a
 * good file, and its open list is under the reader's cap. The same three conditions as `answers` in
 * `broker/decisions/thread.ts`, which closes the decisions card's asks on the same question.
 */
function answers(reading: LedgerReading): boolean {
  return reading.hasLedger && reading.fileAge !== null && reading.open.length < MAX_ASKS_PER_LIST;
}

/**
 * The readings a view is drawn from, with the operator's marks merged in: the merge first drops the
 * handled marks of asks the ledger no longer lists open, of entries `blocked` no longer reads as
 * blocked for the mark's reason, and of reviews whose pull request number no queue entry under the
 * persona carries, then carries the marks as they stand. `blocked` is `blockedReasons` from
 * `./views.ts`, handed in so this module needs no import of the views; the review numbers are read
 * here from the queues reading. The one merge the broker and the tests share.
 */
export function withMarks<T extends { ledger: { value: readonly LedgerReading[] | null }; queues: QueuesWithNumbers }>(
  base: T,
  store: WatermarkStore,
  blocked: (base: T) => BlockedReasons,
): T & { marks: Marks } {
  store.pruneHandled(base.ledger.value, blocked(base), reviewNumbersOf(base.queues));
  return { ...base, marks: store.marks() };
}

/**
 * Whether a handled mark still stands against the readings: an ask's while the ledger cannot say the
 * ask closed, a blocked entry's while the queues reading cannot say the block ended or changed, and a
 * review's while the queues reading cannot say no entry under the persona carries the number.
 */
function stands(
  mark: HandledMark,
  covered: ReadonlyMap<string, LedgerReading> | null,
  blocked: BlockedReasons,
  reviews: ReviewNumbers,
): boolean {
  if (mark.kind === "blocked") {
    const entries = blocked?.get(mark.repo);
    return entries === undefined || entries.get(mark.entryId) === mark.reason;
  }
  if (mark.kind === "review") {
    const numbers = reviews?.get(mark.repo);
    return numbers === undefined || numbers.has(mark.pullRequest);
  }
  const reading = covered?.get(mark.repo);
  return reading === undefined || !answers(reading) || reading.open.some((ask) => ask.id === mark.askId);
}

/** The file for a broker whose state file is `stateFile`. */
export function watermarksFileFor(stateFile: string): string {
  return path.join(path.dirname(stateFile), WATERMARKS_FILE_NAME);
}

/** Opens the store over `file`, reading it once; see the header for what an unreadable file does. */
export function openWatermarks(file: string, log: (message: string) => void = (): void => {}): WatermarkStore {
  let current: Marks = EMPTY_MARKS;
  let text: string | null = null;
  try {
    text = readFileSync(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      log("web watermarks: the file could not be read, so every mark starts empty");
    }
  }
  if (text !== null) {
    const parsed = parseMarks(text);
    if (parsed === null) log("web watermarks: the file is not a mark file, so every mark starts empty");
    else current = parsed;
  }

  function commit(next: Marks): void {
    writeSnapshot(file, serialize(next));
    current = next;
  }

  /** The readings whose prune last failed to write, so the same readings are not written again. */
  let failedOn: { ledger: readonly LedgerReading[] | null; blocked: BlockedReasons; reviews: ReviewNumbers } | null = null;

  return {
    marks: () => current,
    caughtUp(repo, at) {
      commit({ ...current, repos: new Map(current.repos).set(repo, at) });
    },
    seen(root, relativePath, snapshot, at) {
      const mark: PlanMark = { root, path: relativePath, seenAt: at, ...snapshot };
      commit({ ...current, plans: new Map(current.plans).set(planMarkKey(root, relativePath), mark) });
    },
    markHandled(mark) {
      commit({ ...current, handled: new Map(current.handled).set(keyOf(mark), mark) });
    },
    pruneHandled(ledger, blocked, reviews = null) {
      if (current.handled.size === 0) return;
      // Readings that failed to write are not retried until the next pass brings new ones.
      if (failedOn !== null && failedOn.ledger === ledger && failedOn.blocked === blocked && failedOn.reviews === reviews) return;
      const covered = ledger === null ? null : new Map(ledger.map((reading) => [reading.name, reading]));
      const kept = new Map<string, HandledMark>();
      for (const [key, mark] of current.handled) {
        if (stands(mark, covered, blocked, reviews)) kept.set(key, mark);
      }
      if (kept.size === current.handled.size) return;
      try {
        commit({ ...current, handled: kept });
        failedOn = null;
      } catch {
        if (failedOn === null) log("web watermarks: a closed item's handled mark could not be dropped, so the file keeps it");
        failedOn = { ledger, blocked, reviews };
      }
    },
  };
}
